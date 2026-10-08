/**
 * lib/realtime/server.ts — Socket.io realtime server for AvoMessage.
 *
 * Attached to the same HTTP server as Next.js in `server.ts`
 * (`attachRealtime(httpServer)`). Implements the event catalog in
 * `docs/ARCHITECTURE.md` §3.2 / `lib/realtime/events.ts`:
 *
 *   auth (signed session cookie on handshake) · membership-checked room joins
 *   (`user:{id}` auto-joined; `conversation:{id}` / `company:{id}` / `call:{id}`
 *   on verified join) · presence with disconnect grace period · typing
 *   indicators (5s auto-clear) · idempotent message send (clientId dedupe) ·
 *   delivery/read receipts · notifications fan-out · feed fan-out · WebRTC
 *   call signaling with persisted call-state transitions.
 *
 * HARD RULES (enforced throughout):
 *   - never trust client-supplied user ids — every handler uses
 *     `socket.data.userId` set by the auth middleware;
 *   - every client→server payload is validated with zod before handling;
 *   - private data is only emitted to membership-checked rooms;
 *   - per-user rate limits on all events (see lib/rate-limit.ts).
 *
 * Cross-module API for services/route handlers (notifications, feed, calls):
 *   getRealtime()?.notifyUser(userId, notification)
 *   getRealtime()?.broadcastFeedPost(post, followerIds)
 *   getRealtime()?.revokeRoom(userId, room)   // e.g. removed from conversation
 */

import type { Server as HttpServer } from 'node:http';
import { Server, Socket } from 'socket.io';
import { z } from 'zod';
import {
  ClientToServer,
  ServerToClient,
  ERROR_CODES,
  ClientPayloadSchemas,
  roomUser,
  roomConversation,
  roomCompany,
  roomCall,
  type ClientToServerEvent,
  type PresenceStatus,
  type MessagePayload,
  type MessageAuthorPayload,
  type MessageQuotePayload,
  type NotificationPayload,
  type FeedPostPayload,
  type CallIncomingPayload,
  type ErrorPayload,
} from './events.js';
import { checkRateLimit } from '../rate-limit.js';
import type { PrismaClientLike } from '../prisma-types.js';
import { getDb, setDbOverride, verifyHandshakeSession } from './store.js';
// Bridge for services that create notifications. They cannot import THIS
// module: its `.js`-suffixed imports (required by tsconfig.server.json's
// nodenext resolution) are unresolvable to Next's bundler. See notify.ts.
import { setNotificationEmitter, toNotificationPayload } from './notify.js';
// Notification rows + Web Push for a new message. Shared with the REST path
// (lib/services/messages.ts) so both transports behave identically and the
// deployed app — which never runs this file — still notifies. Alias-free, which
// is why it can be imported here at all.
import { notifyNewMessage } from '../message-notify.js';

// ─────────────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────────────

/** Typing indicator auto-clear. */
const TYPING_TIMEOUT_MS = 5_000;
/** Disconnect grace: mark OFFLINE this long after the last socket drops. */
const PRESENCE_GRACE_MS = 60_000;
/** Unanswered ring → MISSED after this long. */
const RING_TIMEOUT_MS = 45_000;
/** clientId dedupe memory. */
const DEDUPE_TTL_MS = 10 * 60_000;
/** sweepPresence() backstop for entries older than this. */
const PRESENCE_SWEEP_STALE_MS = 10 * 60_000;

// ─────────────────────────────────────────────────────────────────────────────
// In-memory realtime state (per server process)
// ─────────────────────────────────────────────────────────────────────────────

interface PresenceEntry {
  userId: string;
  status: PresenceStatus;
  sockets: Set<string>;
  lastSeen: number;
  offlineTimer?: NodeJS.Timeout;
}

const presence = new Map<string, PresenceEntry>();
/** userId → room → socketIds currently joined (drives presence fan-out). */
const userRooms = new Map<string, Map<string, Set<string>>>();
/** `${conversationId}:${userId}` → auto-clear timer. */
const typingTimers = new Map<string, NodeJS.Timeout>();
/** clientId → sent message (idempotent retries). */
const sendDedupe = new Map<
  string,
  { payload: MessagePayload; expiresAt: number }
>();
/** callId → unanswered-ring timer. */
const ringTimers = new Map<string, NodeJS.Timeout>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sendDedupe) {
    if (entry.expiresAt <= now) sendDedupe.delete(key);
  }
}, 60_000).unref();

// ─────────────────────────────────────────────────────────────────────────────
// Public handle (for services / route handlers / server.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface RealtimeHandle {
  io: Server;
  notifyUser(userId: string, notification: NotificationPayload): void;
  broadcastFeedPost(post: FeedPostPayload, followerIds: string[]): void;
  /** Tell a user's clients to leave a room (membership revoked / suspended). */
  revokeRoom(userId: string, room: string): void;
  emitToConversation(
    conversationId: string,
    event: string,
    payload: unknown,
  ): void;
  emitToUser(userId: string, event: string, payload: unknown): void;
  sweepPresence(): Promise<void>;
  close(): void;
}

let handle: RealtimeHandle | null = null;

/** The attached realtime server, or null when Socket.io is disabled. */
export function getRealtime(): RealtimeHandle | null {
  return handle;
}

/**
 * Attach the Socket.io server to an existing HTTP server. Idempotent —
 * returns the existing handle when called twice (dev HMR safety).
 *
 * @param deps.db — optional explicit database handle (takes precedence over
 *   the lazy `lib/db.ts` singleton). Used by tests to inject a fake.
 */
export function attachRealtime(
  httpServer: HttpServer,
  deps?: { db?: PrismaClientLike },
): RealtimeHandle | null {
  if (handle) return handle;
  if (deps?.db) setDbOverride(deps.db);

  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: allowedOrigins().length > 0 ? allowedOrigins() : true,
      credentials: true,
    },
    // Let briefly-disconnected clients recover missed packets on resubscribe.
    connectionStateRecovery: { maxDisconnectionDuration: 120_000 },
  });

  io.use(authMiddleware);
  io.on('connection', (socket) => void onConnection(io, socket));

  const realtime: RealtimeHandle = {
    io,
    notifyUser(userId, notification) {
      io.to(roomUser(userId)).emit(
        ServerToClient.NOTIFICATION_NEW,
        notification,
      );
    },
    broadcastFeedPost(post, followerIds) {
      for (const followerId of followerIds) {
        io.to(roomUser(followerId)).emit(ServerToClient.FEED_POST_NEW, {
          post,
        });
      }
    },
    revokeRoom(userId, room) {
      io.to(roomUser(userId)).emit(ServerToClient.ROOM_REVOKED, { room });
    },
    emitToConversation(conversationId, event, payload) {
      io.to(roomConversation(conversationId)).emit(event, payload);
    },
    emitToUser(userId, event, payload) {
      io.to(roomUser(userId)).emit(event, payload);
    },
    sweepPresence() {
      return sweepPresence(io);
    },
    close() {
      for (const timer of typingTimers.values()) clearTimeout(timer);
      for (const timer of ringTimers.values()) clearTimeout(timer);
      for (const entry of presence.values()) {
        if (entry.offlineTimer) clearTimeout(entry.offlineTimer);
      }
      io.close();
      handle = null;
      setNotificationEmitter(null);
    },
  };

  handle = realtime;
  // Publish the emitter so services that create notifications (likes,
  // comments, follows, mentions) can push them without importing this module.
  setNotificationEmitter((userId, notification) => realtime.notifyUser(userId, notification));
  const db = getDb();
  console.log(
    `[realtime] Socket.io attached (path /socket.io)${db ? '' : ' — database unavailable, handshakes will fail closed'}`,
  );
  return realtime;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handshake: origin check + session-cookie auth
// ─────────────────────────────────────────────────────────────────────────────

function allowedOrigins(): string[] {
  const raw = process.env.SOCKET_ALLOWED_ORIGINS ?? process.env.APP_URL ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function authMiddleware(
  socket: Socket,
  next: (err?: Error) => void,
): Promise<void> {
  try {
    const origin = socket.handshake.headers.origin as string | undefined;
    const allowed = allowedOrigins();
    if (allowed.length > 0 && origin && !allowed.includes(origin)) {
      next(new Error('origin not allowed'));
      return;
    }
    const session = await verifyHandshakeSession(
      socket.handshake.headers.cookie,
    );
    if (!session) {
      next(new Error('unauthenticated'));
      return;
    }
    // The ONLY trusted user identity for this connection. Handlers must
    // never accept a user id from the client.
    socket.data.userId = session.userId;
    socket.data.sessionId = session.sessionId;
    next();
  } catch (err) {
    next(err instanceof Error ? err : new Error('auth failed'));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection lifecycle
// ─────────────────────────────────────────────────────────────────────────────

async function onConnection(io: Server, socket: Socket): Promise<void> {
  const userId = socket.data.userId as string;
  const db = getDb();

  // Every connection auto-joins its own user room (server-side only —
  // clients can never join another user's room).
  await socket.join(roomUser(userId));
  trackRoom(userId, socket.id, roomUser(userId));

  if (db) {
    await setPresenceOnline(io, db, userId, socket.id);
  }

  registerHandlers(io, socket, userId);

  socket.on('disconnect', () => {
    onDisconnect(io, socket, userId);
  });
}

function trackRoom(userId: string, socketId: string, room: string): void {
  let rooms = userRooms.get(userId);
  if (!rooms) {
    rooms = new Map();
    userRooms.set(userId, rooms);
  }
  let sockets = rooms.get(room);
  if (!sockets) {
    sockets = new Set();
    rooms.set(room, sockets);
  }
  sockets.add(socketId);
}

function untrackRoom(userId: string, socketId: string, room: string): void {
  const rooms = userRooms.get(userId);
  const sockets = rooms?.get(room);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) rooms!.delete(room);
  if (rooms!.size === 0) userRooms.delete(userId);
}

function untrackSocket(userId: string, socketId: string): void {
  const rooms = userRooms.get(userId);
  if (!rooms) return;
  for (const room of [...rooms.keys()]) untrackRoom(userId, socketId, room);
}

function onDisconnect(io: Server, socket: Socket, userId: string): void {
  untrackSocket(userId, socket.id);

  // Clear any typing indicators held by this user.
  for (const [key, timer] of typingTimers) {
    if (key.endsWith(`:${userId}`)) {
      clearTimeout(timer);
      typingTimers.delete(key);
      const conversationId = key.slice(0, key.length - userId.length - 1);
      io.to(roomConversation(conversationId)).emit(
        ServerToClient.TYPING_UPDATE,
        { conversationId, userId, isTyping: false },
      );
    }
  }

  const entry = presence.get(userId);
  if (!entry) return;
  entry.sockets.delete(socket.id);
  if (entry.sockets.size > 0 || entry.offlineTimer) return;

  // Grace period: a quick reconnect (network blip, tab reload) cancels this.
  entry.offlineTimer = setTimeout(() => {
    const current = presence.get(userId);
    if (!current || current.sockets.size > 0) return;
    current.status = 'OFFLINE';
    current.lastSeen = Date.now();
    current.offlineTimer = undefined;
    const db = getDb();
    void db?.userPresence
      .upsert({
        where: { userId },
        create: { userId, status: 'OFFLINE', lastSeenAt: new Date() },
        update: { status: 'OFFLINE', lastSeenAt: new Date() },
      })
      .catch((err: unknown) =>
        console.error('[realtime] presence offline upsert failed:', err),
      );
    broadcastPresence(io, userId, 'OFFLINE');
  }, PRESENCE_GRACE_MS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Presence
// ─────────────────────────────────────────────────────────────────────────────

async function setPresenceOnline(
  io: Server,
  db: PrismaClientLike,
  userId: string,
  socketId: string,
): Promise<void> {
  let entry = presence.get(userId);
  if (entry?.offlineTimer) {
    clearTimeout(entry.offlineTimer);
    entry.offlineTimer = undefined;
  }
  const wasAway = !entry || entry.status === 'OFFLINE' || entry.sockets.size === 0;
  if (!entry) {
    entry = { userId, status: 'ONLINE', sockets: new Set(), lastSeen: Date.now() };
    presence.set(userId, entry);
  }
  entry.sockets.add(socketId);
  entry.lastSeen = Date.now();
  if (entry.status === 'OFFLINE') entry.status = 'ONLINE';

  await db.userPresence
    .upsert({
      where: { userId },
      create: { userId, status: entry.status, lastSeenAt: new Date() },
      update: { status: entry.status, lastSeenAt: new Date() },
    })
    .catch((err: unknown) =>
      console.error('[realtime] presence online upsert failed:', err),
    );

  if (wasAway) broadcastPresence(io, userId, entry.status);
}

/** Broadcast a presence change to the user's conversation + company rooms. */
function broadcastPresence(
  io: Server,
  userId: string,
  status: PresenceStatus,
): void {
  const rooms = userRooms.get(userId);
  if (!rooms) return;
  const payload = {
    userId,
    status,
    lastSeenAt: new Date().toISOString(),
  };
  for (const room of rooms.keys()) {
    if (room.startsWith('conversation:') || room.startsWith('company:')) {
      io.to(room).emit(ServerToClient.PRESENCE_UPDATE, payload);
    }
  }
}

/** Backstop for entries whose sockets vanished without a clean disconnect. */
async function sweepPresence(io: Server): Promise<void> {
  const db = getDb();
  if (!db) return;
  const now = Date.now();
  for (const [userId, entry] of presence) {
    if (
      entry.sockets.size === 0 &&
      entry.status !== 'OFFLINE' &&
      now - entry.lastSeen > PRESENCE_SWEEP_STALE_MS
    ) {
      entry.status = 'OFFLINE';
      await db.userPresence
        .upsert({
          where: { userId },
          create: {
            userId,
            status: 'OFFLINE',
            lastSeenAt: new Date(entry.lastSeen),
          },
          update: { status: 'OFFLINE' },
        })
        .catch(() => undefined);
      broadcastPresence(io, userId, 'OFFLINE');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler plumbing: zod validation + rate limit + DB fail-closed + ack
// ─────────────────────────────────────────────────────────────────────────────

interface HandlerCtx {
  socket: Socket;
  io: Server;
  userId: string;
  db: PrismaClientLike;
  ack: ((response: unknown) => void) | undefined;
}

function emitError(
  socket: Socket,
  code: ErrorPayload['code'],
  message: string,
): void {
  socket.emit(ServerToClient.ERROR, { code, message } satisfies ErrorPayload);
}

function forbidden(ctx: HandlerCtx, message = 'Forbidden.'): void {
  emitError(ctx.socket, ERROR_CODES.FORBIDDEN, message);
  ctx.ack?.({ ok: false, code: ERROR_CODES.FORBIDDEN });
}

function register<S extends z.ZodTypeAny>(
  socket: Socket,
  io: Server,
  userId: string,
  event: ClientToServerEvent,
  schema: S,
  limit: { limit: number; windowMs: number },
  handler: (data: z.infer<S>, ctx: HandlerCtx) => Promise<void>,
): void {
  socket.on(event, (payload: unknown, ack: unknown) => {
    void (async () => {
      const ackFn =
        typeof ack === 'function'
          ? (ack as (response: unknown) => void)
          : undefined;

      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        emitError(socket, ERROR_CODES.VALIDATION_ERROR, 'Invalid payload.');
        ackFn?.({ ok: false, code: ERROR_CODES.VALIDATION_ERROR });
        return;
      }

      const rl = checkRateLimit({
        key: `rt:${userId}:${event}`,
        limit: limit.limit,
        windowMs: limit.windowMs,
      });
      if (!rl.allowed) {
        emitError(
          socket,
          ERROR_CODES.RATE_LIMITED,
          'Rate limit exceeded. Slow down.',
        );
        ackFn?.({ ok: false, code: ERROR_CODES.RATE_LIMITED });
        return;
      }

      const db = getDb();
      if (!db) {
        emitError(
          socket,
          ERROR_CODES.INTERNAL,
          'Realtime database unavailable.',
        );
        ackFn?.({ ok: false, code: ERROR_CODES.INTERNAL });
        return;
      }

      try {
        await handler(parsed.data as z.infer<S>, {
          socket,
          io,
          userId,
          db,
          ack: ackFn,
        });
      } catch (err) {
        console.error(
          `[realtime] handler error (${event}, user ${userId}):`,
          err,
        );
        emitError(socket, ERROR_CODES.INTERNAL, 'Internal error.');
        ackFn?.({ ok: false, code: ERROR_CODES.INTERNAL });
      }
    })();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Membership guards (mirror docs/RBAC.md; never trust client claims)
// ─────────────────────────────────────────────────────────────────────────────

async function conversationMember(
  db: PrismaClientLike,
  conversationId: string,
  userId: string,
) {
  return db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
}

async function companyMember(
  db: PrismaClientLike,
  companyId: string,
  userId: string,
) {
  return db.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId } },
  });
}

async function callParticipant(
  db: PrismaClientLike,
  callId: string,
  userId: string,
) {
  return db.callParticipant.findUnique({
    where: { callId_userId: { callId, userId } },
  });
}

async function getPublicUser(
  db: PrismaClientLike,
  userId: string,
): Promise<MessageAuthorPayload | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, username: true, avatarUrl: true },
  });
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    avatarUrl: user.avatarUrl ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload mapping
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal row shape needed to render a quote/forward preview. */
interface QuoteSourceRow {
  id: string;
  body: string | null;
  deletedAt: Date | null;
  sender?: { name: string | null } | null;
}

function toQuotePayload(row: QuoteSourceRow): MessageQuotePayload {
  return {
    id: row.id,
    // A deleted source must not leak its body.
    body: row.deletedAt ? null : row.body,
    authorName: row.sender?.name ?? null,
    deleted: Boolean(row.deletedAt),
  };
}

function toMessagePayload(
  message: {
    id: string;
    conversationId: string;
    senderId: string | null;
    body: string | null;
    type: string;
    createdAt: Date;
    editedAt: Date | null;
    attachments?: Array<{
      id: string;
      kind: string;
      url: string;
      name: string | null;
      mimeType: string | null;
      sizeBytes: number | null;
      width: number | null;
      height: number | null;
    }>;
  },
  author: MessageAuthorPayload | null,
  quotes?: { replyTo?: QuoteSourceRow | null; forwardedFrom?: QuoteSourceRow | null },
): MessagePayload {
  const replyTo = quotes?.replyTo ? toQuotePayload(quotes.replyTo) : null;
  const forwardedFrom = quotes?.forwardedFrom ? toQuotePayload(quotes.forwardedFrom) : null;
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId ?? null,
    body: message.body ?? null,
    type: message.type as MessagePayload['type'],
    ...(replyTo ? { replyToId: replyTo.id, replyTo } : {}),
    ...(forwardedFrom ? { forwardedFrom } : {}),
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt ? message.editedAt.toISOString() : null,
    author,
    attachments: (message.attachments ?? []).map((a) => ({
      id: a.id,
      kind: a.kind as MessagePayload['attachments'][number]['kind'],
      url: a.url,
      name: a.name ?? null,
      mimeType: a.mimeType ?? null,
      sizeBytes: a.sizeBytes ?? null,
      width: a.width ?? null,
      height: a.height ?? null,
    })),
  };
}

// `toNotificationPayload` now lives in ./notify.ts so that services which
// cannot import this module (see the import comment above) can share it.

// ─────────────────────────────────────────────────────────────────────────────
// Event handlers
// ─────────────────────────────────────────────────────────────────────────────

function registerHandlers(io: Server, socket: Socket, userId: string): void {
  const R = ClientToServer;
  const S = ClientPayloadSchemas;

  // — Presence: heartbeat / status change → upsert + fan-out —
  register(socket, io, userId, R.PRESENCE_UPDATE, S[R.PRESENCE_UPDATE], { limit: 30, windowMs: 60_000 },
    async (data, ctx) => {
      const entry = presence.get(userId);
      const prevStatus = entry?.status;
      const nextStatus = data.status;
      if (entry) {
        entry.lastSeen = Date.now();
        if (nextStatus) entry.status = nextStatus;
      } else {
        presence.set(userId, {
          userId,
          status: nextStatus ?? 'ONLINE',
          sockets: new Set([socket.id]),
          lastSeen: Date.now(),
        });
      }
      await ctx.db.userPresence.upsert({
        where: { userId },
        create: {
          userId,
          status: nextStatus ?? entry?.status ?? 'ONLINE',
          lastSeenAt: new Date(),
        },
        // undefined = no-op in Prisma: heartbeat keeps the current status.
        update: { status: nextStatus ?? undefined, lastSeenAt: new Date() },
      });
      if (nextStatus && nextStatus !== prevStatus) {
        broadcastPresence(io, userId, nextStatus);
      }
      ctx.ack?.({ ok: true });
    },
  );

  // — Typing indicators (5s server-side auto-clear) —
  const typing = (isTyping: boolean) =>
    async (data: { conversationId: string }, ctx: HandlerCtx) => {
      const member = await conversationMember(
        ctx.db,
        data.conversationId,
        userId,
      );
      if (!member) {
        forbidden(ctx);
        return;
      }
      setTyping(io, socket, data.conversationId, userId, isTyping);
      ctx.ack?.({ ok: true });
    };
  register(socket, io, userId, R.TYPING_START, S[R.TYPING_START], { limit: 120, windowMs: 60_000 }, typing(true));
  register(socket, io, userId, R.TYPING_STOP, S[R.TYPING_STOP], { limit: 120, windowMs: 60_000 }, typing(false));

  // — Idempotent message send —
  register(socket, io, userId, R.MESSAGE_SEND, S[R.MESSAGE_SEND], { limit: 60, windowMs: 60_000 },
    async (data, ctx) => {
      const member = await conversationMember(
        ctx.db,
        data.conversationId,
        userId,
      );
      if (!member) {
        forbidden(ctx, 'Not a member of this conversation.');
        return;
      }

      // Idempotency: a retry with the same clientId returns the original
      // message instead of creating a duplicate. (ARCHITECTURE.md also calls
      // for a UNIQUE(conversationId, clientId) DB constraint — the messaging /
      // DB agent owns that migration; this in-memory dedupe covers retries
      // within the process lifetime.)
      const cached = sendDedupe.get(data.clientId);
      if (cached && cached.expiresAt > Date.now()) {
        ctx.ack?.({ ok: true, message: cached.payload, deduped: true });
        return;
      }

      // Quoted parent — must live in THIS conversation. Loaded with its
      // author so the live payload carries an inline preview; without it a
      // freshly-arrived reply would render an empty quote until a reload.
      // `deletedAt: null` is deliberately NOT filtered: replying to a
      // soft-deleted message is allowed and renders a tombstone quote.
      let replyToRow: QuoteSourceRow | null = null;
      if (data.replyToId) {
        replyToRow = await ctx.db.message.findFirst({
          where: {
            id: data.replyToId,
            conversationId: data.conversationId,
          },
          select: { id: true, body: true, deletedAt: true, sender: { select: { name: true } } },
        });
        if (!replyToRow) {
          emitError(ctx.socket, ERROR_CODES.VALIDATION_ERROR, 'Replied-to message not found in this conversation.');
          ctx.ack?.({ ok: false, code: ERROR_CODES.VALIDATION_ERROR });
          return;
        }
      }

      // Forward source — MAY live in another conversation, so the sender's
      // membership of THAT conversation is checked explicitly. Skipping this
      // would turn forwarding into a way to read a message you cannot see.
      let forwardRow: QuoteSourceRow | null = null;
      if (data.forwardedFromId) {
        const source = await ctx.db.message.findFirst({
          where: { id: data.forwardedFromId },
          select: {
            id: true,
            body: true,
            deletedAt: true,
            conversationId: true,
            sender: { select: { name: true } },
          },
        });
        if (!source) {
          emitError(ctx.socket, ERROR_CODES.VALIDATION_ERROR, 'Forwarded message not found.');
          ctx.ack?.({ ok: false, code: ERROR_CODES.VALIDATION_ERROR });
          return;
        }
        const sourceMember = await conversationMember(ctx.db, source.conversationId, userId);
        if (!sourceMember) {
          forbidden(ctx, 'You cannot forward a message you have no access to.');
          return;
        }
        forwardRow = source;
      }

      const created = await ctx.db.$transaction(async (tx) => {
        const message = await tx.message.create({
          data: {
            conversationId: data.conversationId,
            senderId: userId,
            body: data.body ?? null,
            type: data.type,
            replyToId: replyToRow?.id ?? null,
            forwardedFromId: forwardRow?.id ?? null,
            attachments: data.attachments?.length
              ? {
                  create: data.attachments.map((a) => ({
                    kind: a.kind,
                    url: a.url,
                    name: a.name ?? null,
                    mimeType: a.mimeType ?? null,
                    sizeBytes: a.sizeBytes ?? null,
                    width: a.width ?? null,
                    height: a.height ?? null,
                  })),
                }
              : undefined,
          },
          include: { attachments: true },
        });
        await tx.conversation.update({
          where: { id: data.conversationId },
          data: { lastMessageAt: message.createdAt },
        });
        return message;
      });

      const author = await getPublicUser(ctx.db, userId);
      const payload = toMessagePayload(created, author, {
        replyTo: replyToRow,
        forwardedFrom: forwardRow,
      });
      sendDedupe.set(data.clientId, {
        payload,
        expiresAt: Date.now() + DEDUPE_TTL_MS,
      });

      // To everyone in the room except the sender (sender gets the ack).
      socket
        .to(roomConversation(data.conversationId))
        .emit(ServerToClient.MESSAGE_NEW, { message: payload });
      ctx.ack?.({ ok: true, message: payload });

      // Conversation-list updates + offline/muted member notifications.
      void fanOutConversationUpdate(
        io,
        ctx.db,
        data.conversationId,
        created,
        author,
        userId,
      ).catch((err: unknown) =>
        console.error('[realtime] conversation fan-out failed:', err),
      );
    },
  );

  // — Delivery receipts (ephemeral broadcast; persistent per-recipient state
  //   awaits the MessageDelivery model — phase 6 per ARCHITECTURE.md) —
  register(socket, io, userId, R.MESSAGE_DELIVERED, S[R.MESSAGE_DELIVERED], { limit: 300, windowMs: 60_000 },
    async (data, ctx) => {
      const message = await ctx.db.message.findUnique({
        where: { id: data.messageId },
        select: { conversationId: true },
      });
      if (!message) {
        emitError(ctx.socket, ERROR_CODES.NOT_FOUND, 'Message not found.');
        ctx.ack?.({ ok: false, code: ERROR_CODES.NOT_FOUND });
        return;
      }
      const member = await conversationMember(
        ctx.db,
        message.conversationId,
        userId,
      );
      if (!member) {
        forbidden(ctx);
        return;
      }
      io.to(roomConversation(message.conversationId)).emit(
        ServerToClient.MESSAGE_DELIVERED,
        { messageId: data.messageId, userId },
      );
      ctx.ack?.({ ok: true });
    },
  );

  // — Read receipts → ConversationMember.lastReadAt + broadcast —
  register(socket, io, userId, R.MESSAGE_READ, S[R.MESSAGE_READ], { limit: 300, windowMs: 60_000 },
    async (data, ctx) => {
      const member = await conversationMember(
        ctx.db,
        data.conversationId,
        userId,
      );
      if (!member) {
        forbidden(ctx, 'Not a member of this conversation.');
        return;
      }
      let readAt: Date;
      if (data.messageId) {
        const message = await ctx.db.message.findUnique({
          where: { id: data.messageId },
          select: { conversationId: true, createdAt: true },
        });
        if (!message || message.conversationId !== data.conversationId) {
          emitError(ctx.socket, ERROR_CODES.NOT_FOUND, 'Message not found.');
          ctx.ack?.({ ok: false, code: ERROR_CODES.NOT_FOUND });
          return;
        }
        readAt = message.createdAt;
      } else {
        readAt = new Date();
      }
      if (readAt > member.lastReadAt) {
        await ctx.db.conversationMember.update({
          where: {
            conversationId_userId: {
              conversationId: data.conversationId,
              userId,
            },
          },
          data: { lastReadAt: readAt },
        });
      }
      io.to(roomConversation(data.conversationId)).emit(
        ServerToClient.MESSAGE_READ,
        {
          conversationId: data.conversationId,
          userId,
          lastReadAt: readAt.toISOString(),
        },
      );
      ctx.ack?.({ ok: true });
    },
  );

  // — Room joins/leaves (membership re-checked on every join) —
  register(socket, io, userId, R.CONVERSATION_JOIN, S[R.CONVERSATION_JOIN], { limit: 60, windowMs: 60_000 },
    async (data, ctx) => {
      const member = await conversationMember(
        ctx.db,
        data.conversationId,
        userId,
      );
      if (!member) {
        forbidden(ctx, 'Not a member of this conversation.');
        return;
      }
      const room = roomConversation(data.conversationId);
      await socket.join(room);
      trackRoom(userId, socket.id, room);
      ctx.ack?.({ ok: true });
    },
  );
  register(socket, io, userId, R.CONVERSATION_LEAVE, S[R.CONVERSATION_LEAVE], { limit: 60, windowMs: 60_000 },
    async (data, ctx) => {
      const room = roomConversation(data.conversationId);
      await socket.leave(room);
      untrackRoom(userId, socket.id, room);
      ctx.ack?.({ ok: true });
    },
  );
  register(socket, io, userId, R.COMPANY_JOIN, S[R.COMPANY_JOIN], { limit: 60, windowMs: 60_000 },
    async (data, ctx) => {
      const member = await companyMember(ctx.db, data.companyId, userId);
      if (!member) {
        forbidden(ctx, 'Not a member of this company.');
        return;
      }
      const room = roomCompany(data.companyId);
      await socket.join(room);
      trackRoom(userId, socket.id, room);
      ctx.ack?.({ ok: true });
    },
  );
  register(socket, io, userId, R.COMPANY_LEAVE, S[R.COMPANY_LEAVE], { limit: 60, windowMs: 60_000 },
    async (data, ctx) => {
      const room = roomCompany(data.companyId);
      await socket.leave(room);
      untrackRoom(userId, socket.id, room);
      ctx.ack?.({ ok: true });
    },
  );

  // — Call room join/leave (participant-checked) —
  register(socket, io, userId, R.CALL_JOIN, S[R.CALL_JOIN], { limit: 60, windowMs: 60_000 },
    async (data, ctx) => {
      const participant = await ensureCallParticipant(
        ctx.db,
        data.callId,
        userId,
      );
      if (!participant) {
        forbidden(ctx, 'Not a participant of this call.');
        return;
      }
      const room = roomCall(data.callId);
      await socket.join(room);
      trackRoom(userId, socket.id, room);
      await ctx.db.callParticipant.update({
        where: { callId_userId: { callId: data.callId, userId } },
        data: { joinedAt: new Date(), leftAt: null },
      });
      io.to(room).emit(ServerToClient.CALL_PARTICIPANT_JOINED, {
        callId: data.callId,
        userId,
      });
      ctx.ack?.({ ok: true });
    },
  );
  register(socket, io, userId, R.CALL_LEAVE, S[R.CALL_LEAVE], { limit: 60, windowMs: 60_000 },
    async (data, ctx) => {
      const room = roomCall(data.callId);
      await socket.leave(room);
      untrackRoom(userId, socket.id, room);
      await ctx.db.callParticipant
        .update({
          where: { callId_userId: { callId: data.callId, userId } },
          data: { leftAt: new Date() },
        })
        .catch(() => undefined);
      io.to(room).emit(ServerToClient.CALL_PARTICIPANT_LEFT, {
        callId: data.callId,
        userId,
      });
      ctx.ack?.({ ok: true });
    },
  );

  // — Call signaling —
  register(socket, io, userId, R.CALL_RING, S[R.CALL_RING], { limit: 10, windowMs: 60_000 },
    async (data, ctx) => {
      await handleCallRing(io, ctx, data);
    },
  );
  register(socket, io, userId, R.CALL_ACCEPT, S[R.CALL_ACCEPT], { limit: 60, windowMs: 60_000 },
    async (data, ctx) => {
      const participant = await callParticipant(ctx.db, data.callId, userId);
      if (!participant) {
        forbidden(ctx, 'Not a participant of this call.');
        return;
      }
      const call = await ctx.db.call.findUnique({
        where: { id: data.callId },
      });
      if (!call) {
        emitError(ctx.socket, ERROR_CODES.NOT_FOUND, 'Call not found.');
        ctx.ack?.({ ok: false, code: ERROR_CODES.NOT_FOUND });
        return;
      }
      if (['ENDED', 'DECLINED', 'FAILED', 'MISSED'].includes(call.status)) {
        emitError(ctx.socket, ERROR_CODES.CONFLICT, `Call already ${call.status.toLowerCase()}.`);
        ctx.ack?.({ ok: false, code: ERROR_CODES.CONFLICT });
        return;
      }
      clearRingTimeout(data.callId);
      await ctx.db.$transaction([
        ctx.db.call.update({
          where: { id: data.callId },
          data: { status: 'ONGOING' },
        }),
        ctx.db.callParticipant.update({
          where: { callId_userId: { callId: data.callId, userId } },
          data: { joinedAt: new Date(), leftAt: null },
        }),
      ]);
      const payload = { callId: data.callId, userId };
      io.to(roomCall(data.callId)).emit(ServerToClient.CALL_ACCEPTED, payload);
      await emitToCallParticipants(ctx.db, io, data.callId, ServerToClient.CALL_ACCEPTED, payload, userId);
      ctx.ack?.({ ok: true });
    },
  );
  register(socket, io, userId, R.CALL_REJECT, S[R.CALL_REJECT], { limit: 60, windowMs: 60_000 },
    async (data, ctx) => {
      const participant = await callParticipant(ctx.db, data.callId, userId);
      if (!participant) {
        forbidden(ctx, 'Not a participant of this call.');
        return;
      }
      const call = await ctx.db.call.findUnique({
        where: { id: data.callId },
      });
      if (!call) {
        emitError(ctx.socket, ERROR_CODES.NOT_FOUND, 'Call not found.');
        ctx.ack?.({ ok: false, code: ERROR_CODES.NOT_FOUND });
        return;
      }
      await ctx.db.callParticipant.update({
        where: { callId_userId: { callId: data.callId, userId } },
        data: { leftAt: new Date() },
      });
      if (call.status === 'RINGING' || call.status === 'INITIATED') {
        clearRingTimeout(data.callId);
        await ctx.db.call.update({
          where: { id: data.callId },
          data: { status: 'DECLINED', endedAt: new Date() },
        });
      }
      const payload = { callId: data.callId, userId };
      io.to(roomCall(data.callId)).emit(ServerToClient.CALL_REJECTED, payload);
      await emitToCallParticipants(ctx.db, io, data.callId, ServerToClient.CALL_REJECTED, payload, userId);
      ctx.ack?.({ ok: true });
    },
  );

  const relaySignal = (
    serverEvent: (typeof ServerToClient)[keyof typeof ServerToClient],
    signalKey: 'sdp' | 'candidate',
  ) => {
    return async (
      data: { callId: string; to?: string; sdp?: unknown; candidate?: unknown },
      ctx: HandlerCtx,
    ) => {
      const participant = await callParticipant(ctx.db, data.callId, userId);
      if (!participant) {
        forbidden(ctx, 'Not a participant of this call.');
        return;
      }
      const payload = {
        callId: data.callId,
        from: userId,
        [signalKey]: data[signalKey],
      };
      if (data.to) {
        // Directed relay — only to a verified participant.
        const target = await callParticipant(ctx.db, data.callId, data.to);
        if (!target) {
          forbidden(ctx, 'Target is not a participant of this call.');
          return;
        }
        io.to(roomUser(data.to)).emit(serverEvent, payload);
      } else {
        // Room relay — SDP is never persisted (ARCHITECTURE.md §5).
        socket.to(roomCall(data.callId)).emit(serverEvent, payload);
      }
      ctx.ack?.({ ok: true });
    };
  };
  register(socket, io, userId, R.CALL_OFFER, S[R.CALL_OFFER], { limit: 240, windowMs: 60_000 }, relaySignal(ServerToClient.CALL_OFFER, 'sdp'));
  register(socket, io, userId, R.CALL_ANSWER, S[R.CALL_ANSWER], { limit: 240, windowMs: 60_000 }, relaySignal(ServerToClient.CALL_ANSWER, 'sdp'));
  register(socket, io, userId, R.CALL_ICE_CANDIDATE, S[R.CALL_ICE_CANDIDATE], { limit: 240, windowMs: 60_000 }, relaySignal(ServerToClient.CALL_ICE_CANDIDATE, 'candidate'));

  register(socket, io, userId, R.CALL_HANGUP, S[R.CALL_HANGUP], { limit: 60, windowMs: 60_000 },
    async (data, ctx) => {
      const participant = await callParticipant(ctx.db, data.callId, userId);
      if (!participant) {
        forbidden(ctx, 'Not a participant of this call.');
        return;
      }
      clearRingTimeout(data.callId);
      await ctx.db.call
        .update({
          where: { id: data.callId },
          data: { status: 'ENDED', endedAt: new Date() },
        })
        .catch(() => undefined);
      await ctx.db.callParticipant
        .update({
          where: { callId_userId: { callId: data.callId, userId } },
          data: { leftAt: new Date() },
        })
        .catch(() => undefined);
      await emitCallEnded(io, ctx.db, data.callId, 'hangup');
      ctx.ack?.({ ok: true });
    },
  );
  register(socket, io, userId, R.CALL_FAILED, S[R.CALL_FAILED], { limit: 60, windowMs: 60_000 },
    async (data, ctx) => {
      const participant = await callParticipant(ctx.db, data.callId, userId);
      if (!participant) {
        forbidden(ctx, 'Not a participant of this call.');
        return;
      }
      clearRingTimeout(data.callId);
      await ctx.db.call
        .update({
          where: { id: data.callId },
          data: { status: 'FAILED', endedAt: new Date() },
        })
        .catch(() => undefined);
      const payload = { callId: data.callId, reason: data.reason ?? 'failed' };
      io.to(roomCall(data.callId)).emit(ServerToClient.CALL_FAILED, payload);
      await emitToCallParticipants(ctx.db, io, data.callId, ServerToClient.CALL_FAILED, payload);
      ctx.ack?.({ ok: true });
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Typing
// ─────────────────────────────────────────────────────────────────────────────

function setTyping(
  io: Server,
  sender: Socket,
  conversationId: string,
  userId: string,
  isTyping: boolean,
): void {
  const key = `${conversationId}:${userId}`;
  const existing = typingTimers.get(key);
  if (existing) clearTimeout(existing);

  if (isTyping) {
    const timer = setTimeout(() => {
      typingTimers.delete(key);
      io.to(roomConversation(conversationId)).emit(
        ServerToClient.TYPING_UPDATE,
        { conversationId, userId, isTyping: false },
      );
    }, TYPING_TIMEOUT_MS);
    typingTimers.set(key, timer);
  } else {
    typingTimers.delete(key);
  }

  // Exclude the sender's own socket (a client never needs its own indicator).
  sender.to(roomConversation(conversationId)).emit(
    ServerToClient.TYPING_UPDATE,
    { conversationId, userId, isTyping },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Message fan-out: conversation list updates + offline/muted notifications
// ─────────────────────────────────────────────────────────────────────────────

async function fanOutConversationUpdate(
  io: Server,
  db: PrismaClientLike,
  conversationId: string,
  message: { id: string; body: string | null; createdAt: Date; attachments?: { kind: string }[] },
  author: MessageAuthorPayload | null,
  senderId: string,
): Promise<void> {
  const members = await db.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true, isMuted: true, lastReadAt: true },
  });
  const lastMessageAt = message.createdAt.toISOString();

  for (const member of members) {
    let unreadCount: number | undefined;
    try {
      unreadCount = await db.message.count({
        where: {
          conversationId,
          deletedAt: null,
          senderId: { not: member.userId },
          createdAt: { gt: member.lastReadAt },
        },
      });
    } catch {
      unreadCount = undefined;
    }
    io.to(roomUser(member.userId)).emit(
      ServerToClient.CONVERSATION_UPDATED,
      {
        conversationId,
        lastMessageAt,
        messageId: message.id,
        ...(unreadCount === undefined ? {} : { unreadCount }),
      },
    );
  }

  /*
   * Notification rows + Web Push.
   *
   * This used to build the notification row inline, and only for members who
   * were offline or muted. Two problems with that:
   *
   *   1. It is the ONLY place that created one, and this file never runs on
   *      Vercel — so the deployed app produced no message notifications at all.
   *      The shared implementation in `lib/message-notify.ts` is now called from
   *      the REST path too (lib/services/messages.ts), which is the path the
   *      deployment actually uses.
   *   2. Muting a conversation silenced nothing, because muted members were
   *      notified. Mute is honoured properly there now.
   *
   * The rows come back so they can also be pushed down live sockets — the
   * polling transport reads them from `GET /api/notifications` instead.
   */
  const created = await notifyNewMessage(db, {
    conversationId,
    senderId,
    senderName: author?.name ?? 'Someone',
    senderAvatarUrl: author?.avatarUrl ?? null,
    messageId: message.id,
    body: message.body,
    hasVoice: (message.attachments ?? []).some((a) => a.kind === 'VOICE'),
    attachmentKinds: (message.attachments ?? []).map((a) => a.kind),
  });

  for (const item of created) {
    io.to(roomUser(item.userId)).emit(
      ServerToClient.NOTIFICATION_NEW,
      toNotificationPayload(item.notification, author),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Calls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a call participant, auto-adding conversation members who join a
 * call linked to their conversation (RBAC.md §2.5). Returns null when the
 * user may not participate.
 */
async function ensureCallParticipant(
  db: PrismaClientLike,
  callId: string,
  userId: string,
) {
  const direct = await callParticipant(db, callId, userId);
  if (direct) return direct;
  const call = await db.call.findUnique({
    where: { id: callId },
    select: { conversationId: true },
  });
  if (!call) return null;
  if (call.conversationId) {
    const member = await conversationMember(
      db,
      call.conversationId,
      userId,
    );
    if (member) {
      return db.callParticipant.upsert({
        where: { callId_userId: { callId, userId } },
        create: { callId, userId },
        update: {},
      });
    }
  }
  return null;
}

function clearRingTimeout(callId: string): void {
  const timer = ringTimers.get(callId);
  if (timer) {
    clearTimeout(timer);
    ringTimers.delete(callId);
  }
}

async function emitToCallParticipants(
  db: PrismaClientLike,
  io: Server,
  callId: string,
  event: string,
  payload: unknown,
  exceptUserId?: string,
): Promise<void> {
  const participants = await db.callParticipant
    .findMany({ where: { callId }, select: { userId: true } })
    .catch(() => []);
  for (const p of participants as Array<{ userId: string }>) {
    if (p.userId === exceptUserId) continue;
    io.to(roomUser(p.userId)).emit(event, payload);
  }
}

async function emitCallEnded(
  io: Server,
  db: PrismaClientLike,
  callId: string,
  reason: string,
): Promise<void> {
  const payload = { callId, reason };
  io.to(roomCall(callId)).emit(ServerToClient.CALL_ENDED, payload);
  await emitToCallParticipants(db, io, callId, ServerToClient.CALL_ENDED, payload);
}

function scheduleRingTimeout(io: Server, callId: string): void {
  clearRingTimeout(callId);
  const timer = setTimeout(() => {
    ringTimers.delete(callId);
    void (async () => {
      const db = getDb();
      if (!db) return;
      const call = await db.call.findUnique({ where: { id: callId } });
      if (!call || call.status !== 'RINGING') return;
      await db.call
        .update({
          where: { id: callId },
          data: { status: 'MISSED', endedAt: new Date() },
        })
        .catch(() => undefined);
      const participants = (await db.callParticipant
        .findMany({ where: { callId }, select: { userId: true } })
        .catch(() => [])) as Array<{ userId: string }>;
      for (const p of participants) {
        if (p.userId === call.initiatorId) continue;
        const notification = await db.notification
          .create({
            data: {
              userId: p.userId,
              actorId: call.initiatorId,
              type: 'CALL_MISSED',
              entityType: 'call',
              entityId: callId,
              title: 'Missed call',
              body: 'You missed a call',
            },
          })
          .catch(() => null);
        if (notification) {
          io.to(roomUser(p.userId)).emit(
            ServerToClient.NOTIFICATION_NEW,
            toNotificationPayload(notification, null),
          );
        }
      }
      await emitCallEnded(io, db, callId, 'missed');
    })().catch((err: unknown) =>
      console.error('[realtime] ring timeout failed:', err),
    );
  }, RING_TIMEOUT_MS);
  ringTimers.set(callId, timer);
}

async function handleCallRing(
  io: Server,
  ctx: HandlerCtx,
  data: { callId?: string; conversationId?: string; userIds?: string[]; type: 'AUDIO' | 'VIDEO' },
): Promise<void> {
  const { db, userId, socket } = ctx;

  let call: {
    id: string;
    type: string;
    conversationId: string | null;
    status: string;
  } | null;

  if (data.callId) {
    // Re-ring an existing call (caller must already be a participant).
    call = await db.call.findUnique({ where: { id: data.callId } });
    if (!call) {
      emitError(socket, ERROR_CODES.NOT_FOUND, 'Call not found.');
      ctx.ack?.({ ok: false, code: ERROR_CODES.NOT_FOUND });
      return;
    }
    const participant = await callParticipant(db, call.id, userId);
    if (!participant) {
      forbidden(ctx, 'Not a participant of this call.');
      return;
    }
    await db.call.update({
      where: { id: call.id },
      data: { status: 'RINGING' },
    });
    call = { ...call, status: 'RINGING' };
  } else {
    // Create + ring a new call.
    const userIds = new Set(data.userIds ?? []);
    userIds.delete(userId);
    const conversationId: string | null = data.conversationId ?? null;
    if (conversationId) {
      const member = await conversationMember(db, conversationId, userId);
      if (!member) {
        forbidden(ctx, 'Not a member of this conversation.');
        return;
      }
      const members = await db.conversationMember.findMany({
        where: { conversationId },
        select: { userId: true },
      });
      for (const m of members as Array<{ userId: string }>) {
        if (m.userId !== userId) userIds.add(m.userId);
      }
    }
    if (userIds.size === 0) {
      emitError(socket, ERROR_CODES.VALIDATION_ERROR, 'No one to call.');
      ctx.ack?.({ ok: false, code: ERROR_CODES.VALIDATION_ERROR });
      return;
    }
    const existing = (await db.user
      .findMany({
        where: { id: { in: [...userIds] }, isActive: true },
        select: { id: true },
      })
      .catch(() => [])) as Array<{ id: string }>;
    const calleeIds = existing.map((u) => u.id);
    if (calleeIds.length === 0) {
      emitError(socket, ERROR_CODES.VALIDATION_ERROR, 'No valid callees.');
      ctx.ack?.({ ok: false, code: ERROR_CODES.VALIDATION_ERROR });
      return;
    }

    const created = await db.$transaction(async (tx) => {
      const newCall = await tx.call.create({
        data: {
          conversationId,
          initiatorId: userId,
          type: data.type,
          status: 'RINGING',
        },
      });
      await tx.callParticipant.createMany({
        data: [
          { callId: newCall.id, userId },
          ...calleeIds.map((id) => ({ callId: newCall.id, userId: id })),
        ],
      });
      return newCall;
    });
    call = created;
  }

  const from = await getPublicUser(db, userId);
  const incoming: CallIncomingPayload = {
    callId: call.id,
    from: userId,
    fromName: from?.name ?? null,
    fromAvatarUrl: from?.avatarUrl ?? null,
    type: call.type as CallIncomingPayload['type'],
    conversationId: call.conversationId,
  };
  await emitToCallParticipants(
    db,
    io,
    call.id,
    ServerToClient.CALL_INCOMING,
    incoming,
    userId,
  );
  scheduleRingTimeout(io, call.id);
  ctx.ack?.({ ok: true, callId: call.id });
}
