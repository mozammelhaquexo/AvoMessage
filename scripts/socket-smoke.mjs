/**
 * scripts/socket-smoke.mjs — realtime layer smoke + integration test.
 *
 * Exercises the COMPILED realtime server (dist-server/) on a bare HTTP
 * server, isolating it from Next.js app-route issues. Two phases:
 *
 *   Phase A (no DB): socket.io attached; handshake without cookie and with a
 *   garbage cookie both fail closed with connect_error 'unauthenticated';
 *   helper fan-outs are safe no-ops.
 *
 *   Phase B (in-memory fake DB injected via attachRealtime deps): full
 *   authenticated flows — session-cookie auth, membership-checked room join,
 *   typing indicators, idempotent message send (clientId dedupe), read
 *   receipts, presence broadcast, validation + forbidden errors, and a
 *   complete call lifecycle (ring → incoming → accept → hangup).
 *
 * Usage:
 *   npm run build:server && npm run realtime:smoke
 *
 * Requires: socket.io, socket.io-client installed. Needs NO real database.
 */
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, createHmac, randomBytes } from 'node:crypto';

const PORT = Number(process.env.SMOKE_PORT ?? 3199);
const PORT_B = PORT + 1;
const SECRET = process.env.SESSION_SECRET ?? 'x'.repeat(40);

let passed = 0;
function assert(name, cond) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ FAILED: ${name}`);
    process.exitCode = 1;
  }
}

const waitFor = (socket, event, timeoutMs = 5000) =>
  Promise.race([
    once(socket, event).then(([p]) => p),
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`timeout waiting for ${event}`)), timeoutMs),
    ),
  ]);

const emitAck = (socket, event, payload, timeoutMs = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), timeoutMs);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });

// ── In-memory fake of the PrismaClientLike surface the realtime layer uses ──
function makeFakeDb() {
  const sessions = new Map();
  const users = new Map([
    ['user1', { id: 'user1', name: 'Ada', username: 'ada', avatarUrl: null }],
    ['user2', { id: 'user2', name: 'Bo', username: 'bo', avatarUrl: null }],
  ]);
  const convMembers = new Map([
    ['conv1:user1', { conversationId: 'conv1', userId: 'user1', role: 'MEMBER', lastReadAt: new Date(0), isMuted: false, joinedAt: new Date() }],
    ['conv1:user2', { conversationId: 'conv1', userId: 'user2', role: 'MEMBER', lastReadAt: new Date(0), isMuted: false, joinedAt: new Date() }],
  ]);
  const messages = [];
  const notifications = [];
  const calls = new Map();
  const callParts = new Map();
  const presenceRows = new Map();
  let n = 0;

  const db = {
    session: {
      findUnique: async ({ where }) => sessions.get(where.tokenHash) ?? null,
      update: async () => ({}),
    },
    user: {
      findUnique: async ({ where, select }) => {
        const u = users.get(where.id) ?? null;
        if (!u || !select) return u;
        return Object.fromEntries(Object.keys(select).map((k) => [k, u[k] ?? null]));
      },
      findMany: async () => [...users.values()].map((u) => ({ id: u.id })),
    },
    userPresence: {
      upsert: async ({ where, create, update }) => {
        const row = { ...(presenceRows.get(where.userId) ?? {}), ...create, ...update, userId: where.userId };
        presenceRows.set(where.userId, row);
        return row;
      },
    },
    conversationMember: {
      findUnique: async ({ where }) =>
        convMembers.get(`${where.conversationId_userId.conversationId}:${where.conversationId_userId.userId}`) ?? null,
      findMany: async ({ where }) =>
        [...convMembers.values()].filter((m) => m.conversationId === where.conversationId),
      update: async ({ where, data }) => {
        const m = convMembers.get(`${where.conversationId_userId.conversationId}:${where.conversationId_userId.userId}`);
        Object.assign(m, data);
        return m;
      },
    },
    conversation: { update: async () => ({}) },
    message: {
      create: async ({ data }) => {
        n += 1;
        const m = {
          id: `msg${n}`,
          ...data,
          createdAt: new Date(),
          editedAt: null,
          attachments: (data.attachments?.create ?? []).map((a, i) => ({ id: `att${n}_${i}`, ...a })),
        };
        messages.push(m);
        return m;
      },
      findUnique: async ({ where }) => messages.find((m) => m.id === where.id) ?? null,
      findFirst: async ({ where }) =>
        messages.find(
          (m) =>
            (!where.id || m.id === where.id) &&
            (!where.conversationId || m.conversationId === where.conversationId),
        ) ?? null,
      count: async () => 0,
    },
    notification: {
      create: async ({ data }) => {
        const notif = { id: `n${notifications.length + 1}`, ...data, createdAt: new Date(), readAt: null };
        notifications.push(notif);
        return notif;
      },
    },
    call: {
      findUnique: async ({ where }) => calls.get(where.id) ?? null,
      create: async ({ data }) => {
        const c = { id: `call${calls.size + 1}`, ...data, startedAt: new Date(), endedAt: null };
        calls.set(c.id, c);
        return c;
      },
      update: async ({ where, data }) => {
        const c = calls.get(where.id);
        Object.assign(c, data);
        return c;
      },
    },
    callParticipant: {
      findUnique: async ({ where }) =>
        callParts.get(`${where.callId_userId.callId}:${where.callId_userId.userId}`) ?? null,
      findMany: async ({ where }) =>
        [...callParts.values()].filter((p) => p.callId === where.callId),
      createMany: async ({ data }) => {
        for (const d of data) {
          callParts.set(`${d.callId}:${d.userId}`, { ...d, joinedAt: new Date(), leftAt: null });
        }
        return { count: data.length };
      },
      update: async ({ where, data }) => {
        const p = callParts.get(`${where.callId_userId.callId}:${where.callId_userId.userId}`);
        Object.assign(p, data);
        return p;
      },
      upsert: async ({ where, create, update }) => {
        const k = `${where.callId_userId.callId}:${where.callId_userId.userId}`;
        let p = callParts.get(k);
        if (p) Object.assign(p, update);
        else {
          p = { ...create, joinedAt: new Date(), leftAt: null };
          callParts.set(k, p);
        }
        return p;
      },
    },
    $transaction: async (fn) => (Array.isArray(fn) ? Promise.all(fn) : fn(db)),
  };
  return { db, sessions };
}

function makeSessionCookie(db, userId) {
  const raw = randomBytes(32).toString('hex');
  const sig = createHmac('sha256', SECRET).update(raw).digest('hex');
  const tokenHash = createHash('sha256').update(raw).digest('hex');
  db.sessions.set(tokenHash, {
    id: `sess-${userId}`,
    tokenHash,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    lastActiveAt: new Date(),
    user: { id: userId, isActive: true, deletedAt: null },
  });
  return `avo_session=${raw}.${sig}`;
}

async function main() {
  const serverMod = await import('../dist-server/lib/realtime/server.js');
  const { io } = await import('socket.io-client');

  const httpServer = createServer((req, res) => {
    res.statusCode = 200;
    res.end('ok');
  });

  // ── Phase A: no DB → fail closed ──────────────────────────────
  console.log('[smoke] Phase A — no database (fail-closed behavior)');
  const realtime = serverMod.attachRealtime(httpServer);
  assert('attachRealtime returns a handle', !!realtime);
  assert('getRealtime() returns the same handle', serverMod.getRealtime() === realtime);

  await new Promise((resolve) => httpServer.listen(PORT, '127.0.0.1', resolve));

  const hsRes = await fetch(`http://127.0.0.1:${PORT}/socket.io/?EIO=4&transport=polling`);
  assert('polling handshake → 200', hsRes.status === 200);
  assert('handshake body looks like engine.io', (await hsRes.text()).startsWith('0{'));

  const unauth = io(`http://127.0.0.1:${PORT}`, { reconnection: false, timeout: 5000 });
  const err = await once(unauth, 'connect_error').then(([e]) => e, () => null);
  unauth.close();
  assert('no cookie → connect_error', !!err);
  assert(`connect_error is 'unauthenticated' (got: ${err && err.message})`, !!err && err.message === 'unauthenticated');

  const badCookie = io(`http://127.0.0.1:${PORT}`, {
    reconnection: false,
    timeout: 5000,
    extraHeaders: { cookie: 'avo_session=garbage' },
  });
  const err2 = await once(badCookie, 'connect_error').then(([e]) => e, () => null);
  badCookie.close();
  assert('garbage cookie → connect_error', !!err2);

  try {
    realtime.notifyUser('user_123', { id: 'n1', type: 'SYSTEM', entityType: null, entityId: null, title: 't', body: 'b', createdAt: new Date().toISOString(), actor: null, readAt: null });
    realtime.broadcastFeedPost({ id: 'p1', authorId: 'u1', body: 'hello', createdAt: new Date().toISOString(), author: null, likeCount: 0, commentCount: 0 }, ['u2']);
    realtime.revokeRoom('user_123', 'conversation:abc');
    realtime.emitToConversation('abc', 'message:new', { message: null });
    realtime.emitToUser('user_123', 'ping', {});
    await realtime.sweepPresence();
    assert('helper fan-outs do not throw with zero clients', true);
  } catch (e) {
    assert(`helper fan-outs do not throw (${e.message})`, false);
  }
  realtime.close();

  // ── Phase B: fake DB → full authenticated flows ────────────────
  // NOTE: separate HTTP server — a second socket.io Server must not share
  // an http.Server with a closed one (engine listeners linger).
  console.log('[smoke] Phase B — authenticated flows (in-memory fake DB)');
  const httpServerB = createServer((req, res) => {
    res.statusCode = 200;
    res.end('ok');
  });
  await new Promise((resolve) => httpServerB.listen(PORT_B, '127.0.0.1', resolve));
  const { db, sessions } = makeFakeDb();
  const cookie1 = makeSessionCookie({ sessions }, 'user1');
  const cookie2 = makeSessionCookie({ sessions }, 'user2');
  const rt2 = serverMod.attachRealtime(httpServerB, { db });
  assert('attachRealtime accepts injected db', !!rt2);

  const connect = async (cookie) => {
    const s = io(`http://127.0.0.1:${PORT_B}`, {
      reconnection: false,
      timeout: 5000,
      extraHeaders: { cookie },
    });
    await once(s, 'connect');
    return s;
  };

  const c1 = await connect(cookie1);
  assert('client1 connects with valid session cookie', c1.connected);
  const c2 = await connect(cookie2);
  assert('client2 connects with valid session cookie', c2.connected);

  // Membership-checked join.
  const joinAck = await emitAck(c1, 'conversation:join', { conversationId: 'conv1' });
  assert('conversation:join ack ok (member)', joinAck && joinAck.ok === true);
  const joinAck2 = await emitAck(c2, 'conversation:join', { conversationId: 'conv1' });
  assert('client2 joins conv1', joinAck2 && joinAck2.ok === true);

  const forbiddenJoin = await new Promise((resolve) => {
    c1.once('error', resolve);
    c1.emit('conversation:join', { conversationId: 'conv-nope' }, () => undefined);
  });
  assert('join non-member conversation → error FORBIDDEN', forbiddenJoin && forbiddenJoin.code === 'FORBIDDEN');

  // Typing.
  const typingP = waitFor(c2, 'typing:update');
  c1.emit('typing:start', { conversationId: 'conv1' });
  const typing = await typingP;
  assert('typing:update reaches room (isTyping=true, user1)', typing.isTyping === true && typing.userId === 'user1' && typing.conversationId === 'conv1');

  // Idempotent message send.
  const newMsgP = waitFor(c2, 'message:new');
  const sendAck = await emitAck(c1, 'message:send', { conversationId: 'conv1', clientId: 'client-id-0001', body: 'hello world' });
  assert('message:send ack ok with message', sendAck && sendAck.ok === true && !!sendAck.message && sendAck.message.body === 'hello world');
  const newMsg = await newMsgP;
  assert('message:new broadcast to other member', newMsg.message.body === 'hello world' && newMsg.message.author.username === 'ada');

  const dupAck = await emitAck(c1, 'message:send', { conversationId: 'conv1', clientId: 'client-id-0001', body: 'hello world' });
  assert('retry with same clientId → deduped, same message id', dupAck && dupAck.ok === true && dupAck.deduped === true && dupAck.message.id === sendAck.message.id);

  // Validation.
  const validationErr = await new Promise((resolve) => {
    c1.once('error', resolve);
    c1.emit('message:send', { bogus: 1 }, () => undefined);
  });
  assert('invalid payload → error VALIDATION_ERROR', validationErr && validationErr.code === 'VALIDATION_ERROR');

  // Read receipts.
  const readP = waitFor(c1, 'message:read');
  c2.emit('message:read', { conversationId: 'conv1', messageId: sendAck.message.id });
  const read = await readP;
  assert('message:read broadcast with userId + lastReadAt', read.userId === 'user2' && typeof read.lastReadAt === 'string');

  // Presence.
  const presenceP = waitFor(c2, 'presence:update');
  c1.emit('presence:update', { status: 'AWAY' });
  const pres = await presenceP;
  assert('presence:update broadcast (AWAY, user1)', pres.userId === 'user1' && pres.status === 'AWAY');

  // Call lifecycle: ring → incoming → accept → hangup.
  const incomingP = waitFor(c2, 'call:incoming');
  const ringAck = await emitAck(c1, 'call:ring', { userIds: ['user2'], type: 'AUDIO' });
  assert('call:ring ack ok with callId', ringAck && ringAck.ok === true && typeof ringAck.callId === 'string');
  const incoming = await incomingP;
  assert('call:incoming reaches callee user room', incoming.callId === ringAck.callId && incoming.from === 'user1' && incoming.type === 'AUDIO');
  const callId = ringAck.callId;

  const acceptedP = waitFor(c1, 'call:accepted');
  const acceptAck = await emitAck(c2, 'call:accept', { callId });
  assert('call:accept ack ok', acceptAck && acceptAck.ok === true);
  const accepted = await acceptedP;
  assert('call:accepted reaches initiator user room', accepted.callId === callId && accepted.userId === 'user2');

  // Signaling relay (offer) — join call rooms first.
  await emitAck(c1, 'call:join', { callId });
  await emitAck(c2, 'call:join', { callId });
  const offerP = waitFor(c2, 'call:offer');
  c1.emit('call:offer', { callId, sdp: { type: 'offer', sdp: 'fake' } });
  const offer = await offerP;
  assert('call:offer relayed to call room (from=user1)', offer.from === 'user1' && offer.sdp.sdp === 'fake');

  const endedP = waitFor(c2, 'call:ended');
  const hangupAck = await emitAck(c1, 'call:hangup', { callId });
  assert('call:hangup ack ok', hangupAck && hangupAck.ok === true);
  const ended = await endedP;
  assert('call:ended broadcast (reason=hangup)', ended.callId === callId && ended.reason === 'hangup');

  c1.close();
  c2.close();
  rt2.close();
  httpServer.close();
  httpServerB.close();
  console.log(`[smoke] ${passed} assertions passed`);
}

main().catch((err) => {
  console.error('[smoke] fatal:', err);
  process.exit(1);
});
