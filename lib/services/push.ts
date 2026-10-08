/**
 * lib/services/push.ts — Web Push, Next-side surface.
 *
 * The actual push machinery (VAPID resolution, sending, and the "somebody sent
 * a message" notification) lives in `lib/message-notify.ts`, because the
 * Socket.io server also needs it and that file is compiled by
 * `tsconfig.server.json`, which cannot resolve the `@/` alias. This module is
 * the thin wrapper the route handlers and the rest of the services use: it
 * binds the app's own Prisma client so callers never pass one.
 *
 * What is left here is subscription bookkeeping — the rows that record where a
 * user can be reached.
 */

import { prisma } from '@/lib/db';
import type { PrismaClientLike } from '@/lib/prisma-types';
import {
  pushToUsers as pushToUsersWith,
  resolveVapidKeys,
  type PushPayload,
} from '@/lib/message-notify';

const db = prisma as unknown as PrismaClientLike;

export type { PushPayload } from '@/lib/message-notify';

/* ------------------------------------------------------------------ */
/* Keys                                                                */
/* ------------------------------------------------------------------ */

/** The VAPID public key the browser needs, or null when push is unavailable. */
export async function getPublicKey(): Promise<string | null> {
  return (await resolveVapidKeys(db))?.publicKey ?? null;
}

/* ------------------------------------------------------------------ */
/* Subscriptions                                                       */
/* ------------------------------------------------------------------ */

export interface SaveSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}

/**
 * Store (or refresh) this browser's endpoint for a user.
 *
 * `endpoint` is unique across the table, so a re-subscribe from the same
 * browser profile updates the existing row. That also re-points the row at the
 * current user, which is the right behaviour on a shared machine: whoever is
 * signed in now gets the notifications.
 */
export async function saveSubscription(
  userId: string,
  input: SaveSubscriptionInput,
): Promise<{ id: string }> {
  const row = await db.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent ?? null,
    },
    update: {
      userId,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent ?? null,
      lastUsedAt: new Date(),
      failureCount: 0,
    },
  });
  return { id: row.id };
}

/**
 * Forget an endpoint. Scoped by `userId` so one user cannot silence another
 * user's device by naming its endpoint.
 */
export async function deleteSubscription(
  userId: string,
  endpoint: string,
): Promise<{ removed: number }> {
  const res = await db.pushSubscription.deleteMany({ where: { userId, endpoint } });
  return { removed: res.count };
}

/** How many devices this user has notifications enabled on. */
export async function countSubscriptions(userId: string): Promise<number> {
  return db.pushSubscription.count({ where: { userId } });
}

/** Forget every endpoint belonging to a user (used when notifications go off). */
export async function deleteAllSubscriptions(userId: string): Promise<{ removed: number }> {
  const res = await db.pushSubscription.deleteMany({ where: { userId } });
  return { removed: res.count };
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

/** `pushToUsers` with the app's client already bound. */
export function pushToUsers(
  userIds: readonly string[],
  payload: PushPayload,
): Promise<{ sent: number; attempted: number }> {
  return pushToUsersWith(db, userIds, payload);
}
