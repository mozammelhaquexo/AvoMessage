/**
 * A message reaching the OTHER person — the notification half of sending.
 *
 * THE BUG THIS FILE PINS DOWN
 * The operator reported, in these words:
 *
 *     "amr avomessage tab ta jodi close thake tahole chrome er moton
 *      notification ashe na, kono user message korle o notification ashe na"
 *
 * Two independent causes, both fixed here, and both invisible to the sender:
 *
 *   1. Notification creation lived ONLY in `fanOutConversationUpdate`
 *      (`lib/realtime/server.ts`). Vercel runs Next route handlers and never
 *      runs `server.ts`, so on the deployment NO message notification row was
 *      ever written. `POST /api/conversations/:id/messages` — the route the
 *      deployed app actually calls — created the message and told nobody.
 *
 *   2. Even locally, the socket implementation only notified a member who was
 *      OFFLINE or MUTED. A muted member being notified makes mute a no-op, and
 *      an online member never got a row at all.
 *
 * These tests drive the real HTTP route against a real database, so they fail
 * if either cause comes back. Push delivery itself is not exercised — that
 * needs a browser and a push service, and is covered at the payload level in
 * tests/message-notify.test.ts.
 *
 * Requires DATABASE_URL (see tests/setup.ts).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { resolveVapidKeys } from '@/lib/message-notify';
import { signup } from '@/lib/services/auth';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import { POST as createConversationRoute } from '@/app/api/conversations/route';
import { POST as sendMessageRoute } from '@/app/api/conversations/[id]/messages/route';
import { POST as muteRoute } from '@/app/api/conversations/[id]/mute/route';
import { TestAgent, uniqueUser } from '../helpers';

const agents: TestAgent[] = [];
function agent() {
  const a = new TestAgent();
  agents.push(a);
  return a;
}
afterAll(async () => {
  for (const a of agents) await a.cleanup();
  await prisma.$disconnect();
});
beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

async function verifiedAgent(prefix: string) {
  const u = uniqueUser(prefix);
  const created = await signup(
    { name: u.name, username: u.username, email: u.email, password: u.password },
    {},
  );
  const a = agent();
  a.trackUser(created.user.id);
  const v = await a.call(verifyEmailRoute, '/api/auth/verify-email', {
    method: 'POST',
    body: { token: created.verificationToken },
    csrf: false,
  });
  expect(v.res.status).toBe(200);
  const login = await a.call(loginRoute, '/api/auth/login', {
    method: 'POST',
    body: { email: u.email, password: u.password },
    csrf: false,
  });
  expect(login.res.status).toBe(200);
  return { agent: a, user: created.user, email: u.email };
}

async function openConversation(a: TestAgent, body: Record<string, unknown>) {
  const { res, json } = await a.call(createConversationRoute, '/api/conversations', {
    method: 'POST',
    body,
  });
  expect(res.status).toBe(201);
  return (json as { conversation: { id: string } }).conversation.id;
}

async function send(a: TestAgent, conversationId: string, body: Record<string, unknown>) {
  const { res, json } = await a.callWithParams(
    sendMessageRoute,
    `/api/conversations/${conversationId}/messages`,
    { id: conversationId },
    { method: 'POST', body },
  );
  return { res, json };
}

/** Every MESSAGE notification a user holds, newest first. */
function messageNotifications(userId: string) {
  return prisma.notification.findMany({
    where: { userId, type: 'MESSAGE' },
    orderBy: { createdAt: 'desc' },
  });
}

describe('a sent message notifies the recipient', () => {
  it('writes a notification for the other member of a direct message', async () => {
    const alice = await verifiedAgent('mnA');
    const bob = await verifiedAgent('mnB');
    const conversationId = await openConversation(alice.agent, {
      type: 'DM',
      userIds: [bob.user.id],
    });

    const { res } = await send(alice.agent, conversationId, { body: 'hello bob' });
    expect(res.status).toBe(201);

    const rows = await messageNotifications(bob.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe('hello bob');
    // Named after the sender, not the generic "New message" the socket path used.
    expect(rows[0]!.title).toBe(alice.user.name);
    // The conversation is the only routable id — /messages/<messageId> is not a route.
    expect(rows[0]!.entityType).toBe('conversation');
    expect(rows[0]!.entityId).toBe(conversationId);
    expect(rows[0]!.actorId).toBe(alice.user.id);
    expect(rows[0]!.readAt).toBeNull();
  });

  it('never notifies the sender about their own message', async () => {
    const alice = await verifiedAgent('mnSelfA');
    const bob = await verifiedAgent('mnSelfB');
    const conversationId = await openConversation(alice.agent, {
      type: 'DM',
      userIds: [bob.user.id],
    });

    await send(alice.agent, conversationId, { body: 'talking to myself' });

    expect(await messageNotifications(alice.user.id)).toHaveLength(0);
  });

  it('notifies every other member of a group', async () => {
    const alice = await verifiedAgent('mnGrpA');
    const bob = await verifiedAgent('mnGrpB');
    const carol = await verifiedAgent('mnGrpC');
    const conversationId = await openConversation(alice.agent, {
      type: 'GROUP',
      userIds: [bob.user.id, carol.user.id],
      title: 'Design Team',
    });

    await send(alice.agent, conversationId, { body: 'standup in 5' });

    const bobRows = await messageNotifications(bob.user.id);
    const carolRows = await messageNotifications(carol.user.id);
    expect(bobRows).toHaveLength(1);
    expect(carolRows).toHaveLength(1);
    // The group is named too, so the banner says where it came from.
    expect(bobRows[0]!.title).toBe(`${alice.user.name} · Design Team`);
    expect(carolRows[0]!.title).toBe(`${alice.user.name} · Design Team`);
  });

  it('does not notify a member who muted the conversation', async () => {
    const alice = await verifiedAgent('mnMuteA');
    const bob = await verifiedAgent('mnMuteB');
    const conversationId = await openConversation(alice.agent, {
      type: 'DM',
      userIds: [bob.user.id],
    });

    const muted = await bob.agent.callWithParams(
      muteRoute,
      `/api/conversations/${conversationId}/mute`,
      { id: conversationId },
      { method: 'POST', body: { muted: true } },
    );
    expect(muted.res.status).toBe(200);

    await send(alice.agent, conversationId, { body: 'this should be silent' });

    expect(await messageNotifications(bob.user.id)).toHaveLength(0);
  });

  it('notifies again once the conversation is unmuted', async () => {
    const alice = await verifiedAgent('mnUnmA');
    const bob = await verifiedAgent('mnUnmB');
    const conversationId = await openConversation(alice.agent, {
      type: 'DM',
      userIds: [bob.user.id],
    });

    const setMute = (muted: boolean) =>
      bob.agent.callWithParams(
        muteRoute,
        `/api/conversations/${conversationId}/mute`,
        { id: conversationId },
        { method: 'POST', body: { muted } },
      );
    await setMute(true);
    await send(alice.agent, conversationId, { body: 'muted' });
    await setMute(false);
    await send(alice.agent, conversationId, { body: 'unmuted' });

    const rows = await messageNotifications(bob.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe('unmuted');
  });

  it('describes an attachment-only message instead of showing an empty preview', async () => {
    const alice = await verifiedAgent('mnAttA');
    const bob = await verifiedAgent('mnAttB');
    const conversationId = await openConversation(alice.agent, {
      type: 'DM',
      userIds: [bob.user.id],
    });

    await send(alice.agent, conversationId, {
      type: 'IMAGE',
      attachments: [
        {
          kind: 'IMAGE',
          url: 'https://cdn.example.com/photo.png',
          name: 'photo.png',
          mimeType: 'image/png',
          sizeBytes: 1234,
        },
      ],
    });

    const rows = await messageNotifications(bob.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe('📷 Photo');
  });

  it('describes a voice message', async () => {
    const alice = await verifiedAgent('mnVoxA');
    const bob = await verifiedAgent('mnVoiceB');
    const conversationId = await openConversation(alice.agent, {
      type: 'DM',
      userIds: [bob.user.id],
    });

    await send(alice.agent, conversationId, {
      type: 'VOICE',
      voice: {
        url: 'https://cdn.example.com/note.webm',
        durationSeconds: 4,
      },
    });

    const rows = await messageNotifications(bob.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe('🎤 Voice message');
  });

  it('does not notify twice when a client retries with the same id', async () => {
    const alice = await verifiedAgent('mnRetryA');
    const bob = await verifiedAgent('mnRetryB');
    const conversationId = await openConversation(alice.agent, {
      type: 'DM',
      userIds: [bob.user.id],
    });

    const clientId = `retry-${Date.now()}`;
    const first = await send(alice.agent, conversationId, { body: 'once', clientId });
    const second = await send(alice.agent, conversationId, { body: 'once', clientId });
    expect(first.res.status).toBe(201);
    // A repeat of the same clientId is an idempotent replay, not a new message.
    expect(second.res.status).toBe(200);

    expect(await messageNotifications(bob.user.id)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* The push leg                                                        */
/* ------------------------------------------------------------------ */

describe('a sent message reaches the recipient’s devices', () => {
  it('actually attempts a push, not just a database row', async () => {
    const alice = await verifiedAgent('mnPushA');
    const bob = await verifiedAgent('mnPushB');
    const conversationId = await openConversation(alice.agent, {
      type: 'DM',
      userIds: [bob.user.id],
    });

    /*
     * A REAL endpoint URL, deliberately unroutable.
     *
     * `lib/message-notify.ts` builds the VAPID pair on first use and hands the
     * subscription to `web-push`. Letting that run for real — against port 9,
     * the discard port — proves the whole chain executed, because the only way
     * `failureCount` can move off 0 is if `sendNotification` was actually
     * called and actually failed. Mocking the library here would test the mock.
     *
     * This is also the check that would have caught the real defect this suite
     * was written after: with a stale generated Prisma client,
     * `db.pushSubscription` is `undefined`, the fan-out throws, and the error is
     * swallowed by design — so nothing observable happens. Here it is
     * observable.
     */
    const endpoint = `http://127.0.0.1:9/avo-test-${Date.now()}`;
    await prisma.pushSubscription.create({
      data: {
        userId: bob.user.id,
        endpoint,
        p256dh: 'test-p256dh',
        auth: 'test-auth',
      },
    });

    const { res } = await send(alice.agent, conversationId, { body: 'push me' });
    expect(res.status).toBe(201);

    const row = await prisma.pushSubscription.findUnique({ where: { endpoint } });
    expect(row).not.toBeNull();
    // Still present (a connection error is not a 404/410) but marked as failed.
    expect(row!.failureCount).toBe(1);
  });

  it('resolves and persists a VAPID key pair the browser can subscribe with', async () => {
    await resolveVapidKeys(prisma as never);

    const row = await prisma.systemSetting.findUnique({ where: { key: 'push.vapid' } });
    const value = row?.value as { publicKey?: unknown; privateKey?: unknown } | null;
    expect(typeof value?.publicKey).toBe('string');
    expect(typeof value?.privateKey).toBe('string');
    // A real uncompressed P-256 point is 65 bytes -> 87 base64url characters.
    expect((value!.publicKey as string).length).toBeGreaterThan(80);
  });

  it('does not push to a member with no registered device', async () => {
    const alice = await verifiedAgent('mnNoDevA');
    const bob = await verifiedAgent('mnNoDevB');
    const conversationId = await openConversation(alice.agent, {
      type: 'DM',
      userIds: [bob.user.id],
    });

    await send(alice.agent, conversationId, { body: 'nobody listening' });

    expect(
      await prisma.pushSubscription.count({ where: { userId: bob.user.id } }),
    ).toBe(0);
    // The in-app notification is still there — push is an extra, not a substitute.
    expect(await messageNotifications(bob.user.id)).toHaveLength(1);
  });
});
