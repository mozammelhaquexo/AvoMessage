/**
 * Notification push bridge — the seam between the Socket.io server and the
 * services that create notifications.
 *
 * WHY THIS FILE EXISTS
 * `lib/realtime/server.ts` is compiled for plain Node by `tsconfig.server.json`
 * (module/moduleResolution "nodenext"), so its relative imports carry explicit
 * `.js` suffixes — see the comment in that config: "The realtime layer
 * (lib/realtime/*) is alias-free by design."
 *
 * Next's bundler cannot resolve `'../rate-limit.js'`, so importing `server.ts`
 * from a route or a service fails the entire build with
 * `Module not found: Can't resolve '../rate-limit.js'`. That is exactly what
 * happened when `lib/services/notifications.ts` tried to call
 * `getRealtime().notifyUser()` directly.
 *
 * This module has NO runtime imports (the `events` import is type-only and is
 * erased), so both sides can depend on it. The socket server registers an
 * emitter here when it attaches; services call `emitNotification()` and get a
 * silent no-op when realtime is disabled — tests, scripts, `next build`.
 */

import type { MessageAuthorPayload, NotificationPayload } from './events.js';

/**
 * Serialize a persisted Notification row into the `notification:new` payload.
 * Defined here, once, so the server and the services cannot drift apart.
 */
export function toNotificationPayload(
  notification: {
    id: string;
    type: string;
    entityType: string | null;
    entityId: string | null;
    title: string | null;
    body: string | null;
    createdAt: Date;
    readAt: Date | null;
  },
  actor: MessageAuthorPayload | null,
): NotificationPayload {
  return {
    id: notification.id,
    type: notification.type,
    entityType: notification.entityType,
    entityId: notification.entityId,
    title: notification.title,
    body: notification.body,
    createdAt: notification.createdAt.toISOString(),
    actor,
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
  };
}

type NotificationEmitter = (userId: string, payload: NotificationPayload) => void;

/**
 * The emitter lives on `globalThis`, NOT in a module-level `let`.
 *
 * In development Next compiles the route handlers into its own module graph,
 * separate from the `tsx server.ts` entry point that attaches Socket.io. A
 * module-level binding would therefore exist TWICE — the server registers into
 * one copy and `lib/services/notifications.ts` reads the other, empty one, so
 * every notification would be persisted but never pushed.
 *
 * This is the same reason `lib/db.ts` parks the Prisma client on `globalThis`.
 * Verified end-to-end: a real FOLLOW through the HTTP API reaches a live
 * socket as `notification:new`.
 */
const globalForNotify = globalThis as unknown as {
  __avoNotificationEmitter?: NotificationEmitter | null;
};

/** Registered by `attachRealtime`; cleared on `close()`. */
export function setNotificationEmitter(fn: NotificationEmitter | null): void {
  globalForNotify.__avoNotificationEmitter = fn;
}

/**
 * True when a socket server is attached. Lets callers skip the extra actor
 * lookup needed only to build a live payload.
 */
export function hasNotificationEmitter(): boolean {
  return typeof globalForNotify.__avoNotificationEmitter === 'function';
}

/** Push a notification to a user's live sockets. No-op when realtime is off. */
export function emitNotification(userId: string, payload: NotificationPayload): void {
  globalForNotify.__avoNotificationEmitter?.(userId, payload);
}
