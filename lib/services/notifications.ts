/**
 * Notifications service: creation (with preference filtering), listing,
 * mark-read / mark-all-read, and per-user preferences.
 *
 * Other domain agents (messaging, companies, admin) create notifications via
 * `createNotification()` — preference + block checks are applied here, in one
 * place.
 */
import { NotificationType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isBlockedEitherWay } from '@/lib/permissions';
import { NotFoundError, decodeCursor, encodeCursor } from '@/lib/api';
// NOTE: import from `@/lib/realtime/notify`, never `@/lib/realtime/server`.
// server.ts is compiled for plain Node and uses `.js`-suffixed relative
// imports that Next's bundler cannot resolve — importing it here fails the
// whole build with "Module not found: Can't resolve '../rate-limit.js'".
import {
  emitNotification,
  hasNotificationEmitter,
  toNotificationPayload,
} from '@/lib/realtime/notify';
import type { NotificationPrefsInput } from '@/lib/validation';

export const PREF_DEFAULTS = {
  likes: true,
  comments: true,
  follows: true,
  mentions: true,
  messages: true,
  invitations: true,
  announcements: true,
  calls: true,
  security: true,
} as const;

type PrefKey = keyof typeof PREF_DEFAULTS;

const TYPE_TO_PREF: Record<NotificationType, PrefKey | null> = {
  [NotificationType.LIKE]: 'likes',
  [NotificationType.COMMENT]: 'comments',
  [NotificationType.FOLLOW]: 'follows',
  [NotificationType.MENTION]: 'mentions',
  [NotificationType.MESSAGE]: 'messages',
  [NotificationType.CALL_MISSED]: 'calls',
  [NotificationType.INVITATION_RECEIVED]: 'invitations',
  [NotificationType.INVITATION_ACCEPTED]: 'invitations',
  [NotificationType.COMPANY_ROLE_CHANGED]: 'announcements',
  [NotificationType.TEAM_ADDED]: 'announcements',
  [NotificationType.REPORT_STATUS]: 'security',
  [NotificationType.SYSTEM]: null, // system notifications always delivered
  // A new application is an ops-critical queue item for admins — muting it
  // would let applications pile up unseen, so it is always delivered.
  [NotificationType.MANAGER_APPLICATION]: null,
  // The applicant explicitly asked for this decision; silently dropping it
  // behind a preference toggle would be the worst possible outcome.
  [NotificationType.MANAGER_APPLICATION_DECISION]: null,
};

export interface CreateNotificationInput {
  userId: string;
  actorId?: string | null;
  type: NotificationType | keyof typeof NotificationType;
  entityType?: string | null;
  entityId?: string | null;
  title?: string | null;
  body?: string | null;
}

/**
 * Create a notification, honoring the recipient's preferences and blocks.
 * Never notifies about oneself; never throws (callers use .catch).
 *
 * Also pushes the new row over Socket.io (`notification:new`) so the badge and
 * an open notification list update without a reload. Previously only the
 * message and missed-call paths emitted, so likes, comments, follows and
 * mentions stayed invisible until the next page load.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  const type = input.type as NotificationType;
  if (input.actorId && input.actorId === input.userId) return;
  if (input.actorId && (await isBlockedEitherWay(input.actorId, input.userId))) return;

  const prefKey = TYPE_TO_PREF[type];
  if (prefKey) {
    const prefs = await prisma.notificationPreference.findUnique({ where: { userId: input.userId } });
    if (prefs && !prefs[prefKey]) return;
  }

  const data = {
    userId: input.userId,
    actorId: input.actorId ?? null,
    type,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    title: input.title ?? null,
    body: input.body ?? null,
  };

  if (!hasNotificationEmitter()) {
    // No socket server attached (tests, scripts, `next build`): skip the actor
    // join entirely.
    await prisma.notification.create({ data });
    return;
  }

  // One round trip: the wire payload needs the actor's public fields.
  const created = await prisma.notification.create({
    data,
    include: { actor: { select: { id: true, name: true, username: true, avatarUrl: true } } },
  });
  const { actor, ...row } = created;
  emitNotification(input.userId, toNotificationPayload(row, actor));
}

/**
 * Notify every @mentioned user in `text` (excluding the actor and anyone who
 * blocked / was blocked by the actor — enforced inside createNotification).
 * Matches the case-sensitive behavior of post mention parsing in
 * lib/services/posts.ts.
 */
export async function notifyMentions(
  text: string | null | undefined,
  actorId: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  if (!text) return;
  const names = [
    ...new Set([...text.matchAll(/@([a-zA-Z0-9_]{2,30})/g)].map((m) => m[1])),
  ];
  if (names.length === 0) return;
  const users = await prisma.user.findMany({
    where: { username: { in: names }, id: { not: actorId } },
    select: { id: true },
  });
  for (const u of users) {
    await createNotification({
      userId: u.id,
      actorId,
      type: NotificationType.MENTION,
      entityType,
      entityId,
    });
  }
}

export interface NotificationListOpts {
  limit: number;
  cursor: string | null;
  unreadOnly?: boolean;
  /** Restrict to these types (the filter groups in lib/notification-filters.ts). */
  types?: NotificationType[];
}

export async function listNotifications(userId: string, opts: NotificationListOpts) {
  const where: Record<string, unknown> = { userId };
  if (opts.unreadOnly) where.readAt = null;
  if (opts.types && opts.types.length > 0) where.type = { in: opts.types };
  if (opts.cursor) {
    const { createdAt, id } = decodeCursor(opts.cursor);
    where.OR = [
      { createdAt: { lt: createdAt } },
      { createdAt: { equals: createdAt }, id: { lt: id } },
    ];
  }
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: {
        actor: { select: { id: true, name: true, username: true, avatarUrl: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  return {
    data: page.map((n) => ({
      id: n.id,
      type: n.type,
      entityType: n.entityType,
      entityId: n.entityId,
      title: n.title,
      body: n.body,
      readAt: n.readAt,
      actor: n.actor,
      createdAt: n.createdAt,
    })),
    nextCursor:
      hasMore && page.length > 0
        ? encodeCursor(page[page.length - 1]!.createdAt, page[page.length - 1]!.id)
        : null,
    unreadCount,
  };
}

export async function markNotificationRead(userId: string, id: string): Promise<void> {
  const updated = await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (updated.count === 0) {
    const exists = await prisma.notification.findFirst({ where: { id, userId } });
    if (!exists) throw new NotFoundError('Notification not found');
  }
}

export async function markNotificationsRead(userId: string, ids?: string[]): Promise<{ marked: number }> {
  const where: Record<string, unknown> = { userId, readAt: null };
  if (ids && ids.length > 0) where.id = { in: ids };
  const res = await prisma.notification.updateMany({ where, data: { readAt: new Date() } });
  return { marked: res.count };
}

// ─── Preferences ────────────────────────────────────────────────────────────

export async function getPreferences(userId: string): Promise<Record<PrefKey, boolean>> {
  const prefs = await prisma.notificationPreference.findUnique({ where: { userId } });
  const out: Record<PrefKey, boolean> = { ...PREF_DEFAULTS };
  if (prefs) {
    for (const key of Object.keys(PREF_DEFAULTS) as PrefKey[]) {
      out[key] = prefs[key];
    }
  }
  return out;
}

export async function updatePreferences(userId: string, input: NotificationPrefsInput) {
  const data = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined),
  );
  const prefs = await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  const { userId: _u, ...rest } = prefs;
  void _u;
  return rest;
}
