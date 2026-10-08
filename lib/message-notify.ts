/**
 * lib/message-notify.ts — "somebody sent a message": notification rows + Web
 * Push, in one place.
 *
 * WHY IT IS ALIAS-FREE, AND WHY THAT MATTERS
 * Two very different callers need this behaviour:
 *
 *   1. `POST /api/conversations/:id/messages` → `lib/services/messages.ts`.
 *      This is the path the DEPLOYED app uses: Vercel runs Next route handlers
 *      and never runs `server.ts`, so the polling transport
 *      (`lib/realtime/polling.ts`) sends over REST.
 *   2. The Socket.io handler in `lib/realtime/server.ts`, used locally.
 *
 * (2) is compiled by `tsconfig.server.json` with `moduleResolution: "nodenext"`,
 * which cannot resolve the `@/` path alias — that is exactly why
 * `lib/services/notifications.ts` cannot be imported from there. So this module
 * takes the Prisma client as a PARAMETER instead of importing `@/lib/db`, and
 * uses only type-only relative imports (which TypeScript erases). The same
 * shape as `lib/realtime/notify.ts`.
 *
 * THE BUG THIS MODULE FIXES
 * Notification creation used to live ONLY in `fanOutConversationUpdate`
 * (`lib/realtime/server.ts`). Vercel never runs that file, so on the
 * deployment NO message notification row was ever written — the notification
 * centre stayed empty and no desktop notification could fire, no matter what
 * the client did. Reported as "kono user message korle o notification ashe na".
 * Moving it here makes it run on every host and every transport.
 *
 * WHAT A RECIPIENT GETS
 *   - a `Notification` row (so the badge and the centre update), and
 *   - a Web Push message (so the OS shows a banner with the tab CLOSED).
 * Both are skipped for a MUTED conversation — that is what mute means — and
 * both honour `NotificationPreference.messages`. A user who blocked the sender,
 * or was blocked by them, gets neither.
 */

import webpush from 'web-push';
import type { PrismaClientLike } from './prisma-types.js';
// Relative with a `.js` suffix, not the `@/` alias: this module is compiled by
// tsconfig.server.json for the plain-node socket server, and tsc does not
// rewrite path aliases (see the notes in that config).
import { resolveDisplayName } from './display-name.js';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** `SystemSetting` key holding the generated VAPID key pair. */
const VAPID_SETTING_KEY = 'push.vapid';

/** Endpoints are dropped after this many consecutive non-410 failures. */
const MAX_FAILURES = 5;

/** Parallel sends per batch. Quick enough, small enough to be polite. */
const SEND_CONCURRENCY = 8;

/** Message preview length. Matches the previous socket-path behaviour. */
const PREVIEW_CHARS = 140;

/**
 * Upper bound on one push-service round trip.
 *
 * `web-push` sets no request timeout of its own, and the fan-out is awaited
 * inside the sender's own `POST /api/conversations/:id/messages` — a push
 * service that accepts the connection and then never answers would hang the
 * send until the platform kills the function. Failing at 8 s costs one
 * notification; not failing costs the message.
 */
const SEND_TIMEOUT_MS = 8_000;

/** Reject after `ms` so a stalled push cannot hold up the sender. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('push timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * What the service worker receives. Kept small: some push services cap the
 * encrypted payload at 4 KB, and everything here is text the notification needs
 * to render with no further network access.
 */
export interface PushPayload {
  title: string;
  body: string;
  /** In-app path a click opens. */
  url: string;
  /**
   * Collapse key. Keying it by conversation means ten messages from one thread
   * replace each other instead of stacking ten banners — the WhatsApp Web
   * behaviour, and what a phone's notification shade expects.
   */
  tag: string;
  icon?: string;
  /** Unread messages in that conversation, for the app-icon badge. */
  badgeCount?: number;
  /** Keep the banner on screen until dismissed. Defaults to true in the worker. */
  requireInteraction?: boolean;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface NewMessageInput {
  conversationId: string;
  /**
   * The sender's REAL name.
   *
   * Deliberately not pre-resolved: a nickname is a property of the
   * relationship, so the right name differs per recipient — the banner must
   * say "Rahim (accounts)" to the one colleague who renamed him and his real
   * name to everybody else. `notifyNewMessage` does that resolution, per
   * recipient, from the sender's group nickname and each recipient's private
   * contact nickname.
   */
  senderName: string;
  senderId: string;
  senderAvatarUrl: string | null;
  messageId: string;
  body: string | null;
  hasVoice: boolean;
  attachmentKinds: readonly string[];
}

export interface CreatedNotification {
  userId: string;
  notification: {
    id: string;
    type: string;
    entityType: string | null;
    entityId: string | null;
    title: string | null;
    body: string | null;
    createdAt: Date;
    readAt: Date | null;
  };
}

/* ------------------------------------------------------------------ */
/* VAPID keys                                                          */
/* ------------------------------------------------------------------ */

const globalForVapid = globalThis as unknown as {
  __avoVapidKeys?: VapidKeys | null;
  /** The public key currently installed into web-push's module state. */
  __avoVapidApplied?: string | null;
};

function vapidFromEnv(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (publicKey && privateKey) return { publicKey, privateKey };
  return null;
}

interface VapidSettingValue {
  publicKey?: unknown;
  privateKey?: unknown;
}

function readKeys(value: unknown): VapidKeys | null {
  const v = (value ?? null) as VapidSettingValue | null;
  if (typeof v?.publicKey === 'string' && typeof v?.privateKey === 'string') {
    return { publicKey: v.publicKey, privateKey: v.privateKey };
  }
  return null;
}

/**
 * Resolve the VAPID key pair, generating and persisting one on first use.
 *
 * Two sources, in order: the environment (`VAPID_PUBLIC_KEY` /
 * `VAPID_PRIVATE_KEY`), then `SystemSetting`. The second is not laziness — it
 * is the difference between the feature working on the next deploy and the
 * feature silently doing nothing until somebody remembers to paste two
 * variables into the host. The key pair is exactly the kind of value the
 * database already holds, and it is the app's only durable store.
 *
 * `create`-then-re-read rather than `upsert`: two serverless instances warming
 * at once would each generate a pair, and `upsert` would let the second
 * overwrite the first — silently invalidating every subscription the first had
 * already handed to a browser. `create` is atomic on the primary key, so one
 * pair wins and every instance converges on it.
 *
 * Cached on `globalThis`, not a module-level `let`, because in development Next
 * compiles route handlers into a module graph of its own — the same reason
 * `lib/realtime/notify.ts` and `lib/db.ts` do it.
 */
export async function resolveVapidKeys(db: PrismaClientLike): Promise<VapidKeys | null> {
  const cached = globalForVapid.__avoVapidKeys;
  if (cached) return cached;

  const fromEnv = vapidFromEnv();
  if (fromEnv) {
    globalForVapid.__avoVapidKeys = fromEnv;
    return fromEnv;
  }

  try {
    const existing = await db.systemSetting.findUnique({ where: { key: VAPID_SETTING_KEY } });
    const stored = readKeys(existing?.value);
    if (stored) {
      globalForVapid.__avoVapidKeys = stored;
      return stored;
    }

    const generated = webpush.generateVAPIDKeys();
    const keys: VapidKeys = {
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
    };

    try {
      await db.systemSetting.create({
        data: { key: VAPID_SETTING_KEY, value: keys as unknown as object },
      });
    } catch {
      const raced = await db.systemSetting.findUnique({ where: { key: VAPID_SETTING_KEY } });
      const winner = readKeys(raced?.value);
      if (winner) {
        globalForVapid.__avoVapidKeys = winner;
        return winner;
      }
    }

    globalForVapid.__avoVapidKeys = keys;
    return keys;
  } catch (error) {
    console.error('[push] could not resolve VAPID keys', error);
    return null;
  }
}

/**
 * The VAPID `sub` claim. Push services use it to contact the operator about a
 * misbehaving subscription.
 *
 * IT MUST BE `https:` OR `mailto:` — AND GETTING THIS WRONG IS SILENT.
 * `web-push` throws `Vapid subject is not an https: or mailto: URL` from
 * `setVapidDetails`, which happens INSIDE the send path. The throw is caught by
 * design (a push failure must never fail a message send), so the only symptom
 * is that notifications quietly never arrive.
 *
 * The trap is that `.env` ships `APP_URL="http://localhost:3000"` for local
 * development, and a plain `APP_URL || fallback` would therefore disable push
 * in every non-HTTPS environment. So an http origin is explicitly NOT usable
 * here and the claim falls through to a mailbox instead.
 */
function usableSubject(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  // Mirrors web-push's own acceptance test exactly.
  if (trimmed.startsWith('https:') || trimmed.startsWith('mailto:')) return trimmed;
  return null;
}

function vapidSubject(): string {
  const explicit = usableSubject(process.env.VAPID_SUBJECT);
  if (explicit) return explicit;

  const appUrl = usableSubject(process.env.APP_URL);
  // `https:` only: an `http://localhost:3000` APP_URL is the development
  // default and would be rejected by the push service.
  if (appUrl && appUrl.startsWith('https:')) return appUrl;

  // A real mailbox is more useful than a placeholder — a push service that
  // needs to reach the operator has somewhere to write.
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim();
  if (from) {
    const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return `mailto:${address}`;
  }

  return 'mailto:noreply@avomessage.app';
}

/**
 * Install the keys into web-push's module state.
 *
 * `setVapidDetails` writes a module-level variable inside web-push, so it is
 * only re-applied when the public key actually changes — doing it on every send
 * would be wasted work on a hot path.
 */
function applyVapid(keys: VapidKeys): void {
  if (globalForVapid.__avoVapidApplied === keys.publicKey) return;
  webpush.setVapidDetails(vapidSubject(), keys.publicKey, keys.privateKey);
  globalForVapid.__avoVapidApplied = keys.publicKey;
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failureCount: number;
}

/** The push service answers 404/410 for a subscription that no longer exists. */
function isGone(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { statusCode?: unknown })?.statusCode;
  return typeof status === 'number' ? status : undefined;
}

async function sendOne(
  db: PrismaClientLike,
  sub: StoredSubscription,
  payload: PushPayload,
): Promise<void> {
  try {
    await withTimeout(
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        {
          // How long the push service holds the message while the device is
          // offline. A chat message is stale within the hour; queueing it for a
          // day would deliver yesterday's news this evening.
          TTL: 60 * 60,
          // Ask for immediate delivery rather than batching — the entire point
          // of a chat notification.
          urgency: 'high',
        },
      ),
      SEND_TIMEOUT_MS,
    );
    await db.pushSubscription.update({
      where: { id: sub.id },
      data: { lastUsedAt: new Date(), failureCount: 0 },
    });
  } catch (error) {
    const status = statusOf(error);
    if (isGone(status)) {
      // The browser threw the subscription away — uninstalled, data cleared,
      // permission revoked. Nothing will ever succeed here again.
      await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => null);
      return;
    }
    // A transient failure is expected: push services rate-limit and have bad
    // days. Only give up after repeated failures.
    const next = sub.failureCount + 1;
    if (next >= MAX_FAILURES) {
      await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => null);
      return;
    }
    await db.pushSubscription
      .update({ where: { id: sub.id }, data: { failureCount: next } })
      .catch(() => null);
  }
}

/**
 * Push a payload to every device of every listed user.
 *
 * Never throws: callers are inside a request the SENDER is waiting on, and a
 * push service being down must not turn "message sent" into an error. Returns
 * counts so callers, tests and diagnostics can assert on the outcome.
 */
export async function pushToUsers(
  db: PrismaClientLike,
  userIds: readonly string[],
  payload: PushPayload,
): Promise<{ sent: number; attempted: number }> {
  const unique = [...new Set(userIds.filter((id) => typeof id === 'string' && id.length > 0))];
  if (unique.length === 0) return { sent: 0, attempted: 0 };

  const keys = await resolveVapidKeys(db);
  if (!keys) return { sent: 0, attempted: 0 };

  let subscriptions: StoredSubscription[];
  try {
    subscriptions = await db.pushSubscription.findMany({
      where: { userId: { in: unique } },
      select: { id: true, endpoint: true, p256dh: true, auth: true, failureCount: true },
    });
  } catch (error) {
    console.error('[push] could not load subscriptions', error);
    return { sent: 0, attempted: 0 };
  }
  if (subscriptions.length === 0) return { sent: 0, attempted: 0 };

  try {
    applyVapid(keys);
  } catch (error) {
    console.error('[push] VAPID keys rejected', error);
    return { sent: 0, attempted: subscriptions.length };
  }

  let sent = 0;
  for (let i = 0; i < subscriptions.length; i += SEND_CONCURRENCY) {
    const batch = subscriptions.slice(i, i + SEND_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((sub) => sendOne(db, sub, payload)));
    for (const result of results) if (result.status === 'fulfilled') sent += 1;
  }

  return { sent, attempted: subscriptions.length };
}

/* ------------------------------------------------------------------ */
/* New-message notification                                            */
/* ------------------------------------------------------------------ */

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** The second line of the notification, from whatever the message carries. */
function previewOf(input: NewMessageInput): string {
  const body = input.body?.trim();
  if (body) return truncate(body, PREVIEW_CHARS);
  if (input.hasVoice) return '🎤 Voice message';
  const kinds = new Set(input.attachmentKinds);
  if (kinds.has('IMAGE')) return '📷 Photo';
  if (kinds.has('VIDEO')) return '🎥 Video';
  if (kinds.has('FILE')) return '📎 Attachment';
  return 'Sent a message';
}

interface MemberRow {
  userId: string;
  isMuted: boolean;
  lastReadAt: Date;
  /** The member's OWN name inside this group, when they set one. */
  nickname?: string | null;
}

/**
 * Create the notification rows and fire the pushes for one new message.
 *
 * Returns the rows that were created, so the socket server can additionally
 * emit `notification:new` to a live connection (the polling transport picks
 * them up from `GET /api/notifications` instead, and ignores the return value).
 *
 * Muted members are skipped ENTIRELY — no row, no push. The previous socket
 * implementation notified muted members, which made mute a no-op for messages.
 */
export async function notifyNewMessage(
  db: PrismaClientLike,
  input: NewMessageInput,
): Promise<CreatedNotification[]> {
  const conversation = await db.conversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, type: true, title: true, avatarUrl: true },
  });
  if (!conversation) return [];

  const members = await db.conversationMember.findMany<MemberRow>({
    where: { conversationId: input.conversationId },
    select: { userId: true, isMuted: true, lastReadAt: true, nickname: true },
  });

  const recipients = members.filter((m) => m.userId !== input.senderId && !m.isMuted);
  if (recipients.length === 0) return [];

  const recipientIds = recipients.map((m) => m.userId);

  // One query each for blocks and preferences, rather than two per recipient.
  const [blocks, prefs] = await Promise.all([
    db.block
      .findMany({
        where: {
          OR: [
            { blockerId: input.senderId, blockedId: { in: recipientIds } },
            { blockerId: { in: recipientIds }, blockedId: input.senderId },
          ],
        },
        select: { blockerId: true, blockedId: true },
      })
      .catch(() => [] as { blockerId: string; blockedId: string }[]),
    db.notificationPreference
      .findMany({
        where: { userId: { in: recipientIds } },
        select: { userId: true, messages: true },
      })
      .catch(() => [] as { userId: string; messages: boolean }[]),
  ]);

  const blocked = new Set<string>();
  for (const row of blocks) {
    blocked.add(row.blockerId === input.senderId ? row.blockedId : row.blockerId);
  }
  const messagesOff = new Set(
    prefs.filter((p) => p.messages === false).map((p) => p.userId),
  );

  const isGroup = conversation.type === 'GROUP';
  const groupName = conversation.title?.trim() || 'Group';
  const body = previewOf(input);
  // A group's own picture is more recognisable than one member's avatar.
  const icon = (isGroup ? conversation.avatarUrl : input.senderAvatarUrl) ?? undefined;

  /*
   * The sender's GROUP nickname — one value for the whole group, because the
   * member set a name belongs to does not depend on who is reading. Read from
   * the member rows already loaded above, so this costs no extra query.
   */
  const senderGroupNickname =
    members.find((m) => m.userId === input.senderId)?.nickname?.trim() || null;

  /*
   * Each recipient's PRIVATE name for the sender — the part that genuinely
   * differs per person, so it cannot be resolved once outside the loop. One
   * query for every recipient rather than one each.
   */
  const contactRows = await db.contactNickname
    .findMany({
      where: { ownerId: { in: recipientIds }, targetId: input.senderId },
      select: { ownerId: true, nickname: true },
    })
    .catch(() => [] as { ownerId: string; nickname: string }[]);
  const contactByOwner = new Map(contactRows.map((row) => [row.ownerId, row.nickname]));

  /**
   * The name THIS recipient knows the sender by.
   *
   * A notification is where getting this wrong is most obvious: the banner
   * says "Test abc123" while the conversation list right behind it says "Rahim
   * (accounts)". So the chat's own precedence applies here too — the
   * recipient's private nickname, then the sender's group nickname, then the
   * real name.
   */
  const titleFor = (userId: string): string => {
    const senderName = resolveDisplayName({
      realName: input.senderName,
      groupNickname: senderGroupNickname,
      contactNickname: contactByOwner.get(userId) ?? null,
    });
    return isGroup ? `${senderName} · ${groupName}` : senderName;
  };

  const created: CreatedNotification[] = [];
  const toPush: string[] = [];

  for (const member of recipients) {
    if (blocked.has(member.userId)) continue;
    if (messagesOff.has(member.userId)) continue;

    try {
      const row = await db.notification.create({
        data: {
          userId: member.userId,
          actorId: input.senderId,
          type: 'MESSAGE',
          // The client deep-links by entity id, and the only routable id here
          // is the conversation — there is no /messages/<messageId> route.
          // Storing the message id sent readers to a dead link.
          entityType: 'conversation',
          entityId: input.conversationId,
          title: titleFor(member.userId),
          body,
        },
      });
      created.push({
        userId: member.userId,
        notification: {
          id: row.id,
          type: String(row.type),
          entityType: row.entityType,
          entityId: row.entityId,
          title: row.title,
          body: row.body,
          createdAt: row.createdAt,
          readAt: row.readAt,
        },
      });
      toPush.push(member.userId);
    } catch (error) {
      // One bad row must not stop the other recipients.
      console.error('[push] notification insert failed', error);
    }
  }

  if (toPush.length > 0) {
    const pushSet = new Set(toPush);

    // Unread count per recipient, for the app-icon badge. Members of a
    // conversation normally share the same count (nobody has read yet), so the
    // results are grouped by count and one push covers each group — a fan-out
    // per recipient would re-load every subscription row N times.
    const badges = await Promise.all(
      recipients.map(async (member): Promise<readonly [string, number | undefined]> => {
        if (!pushSet.has(member.userId)) return [member.userId, undefined] as const;
        try {
          const count = await db.message.count({
            where: {
              conversationId: input.conversationId,
              deletedAt: null,
              senderId: { not: member.userId },
              createdAt: { gt: member.lastReadAt },
            },
          });
          return [member.userId, count] as const;
        } catch {
          // A missing badge is cosmetic; never let it cost the notification.
          return [member.userId, undefined] as const;
        }
      }),
    );

    /*
     * Bucket by (badge, title) — not by badge alone.
     *
     * The title is now per-recipient, so two recipients with the same unread
     * count can still need different banners: one renamed the sender, the other
     * did not. Grouping on the count alone would send the first recipient's
     * label to the second. Recipients that agree on BOTH still share one push,
     * so the common case (nobody has renamed anybody) is unchanged.
     */
    const byBadgeAndTitle = new Map<string, { badgeCount: number | undefined; title: string; userIds: string[] }>();
    for (const [userId, count] of badges) {
      if (!pushSet.has(userId)) continue;
      const title = titleFor(userId);
      const key = `${count ?? ''}\u0000${title}`;
      const bucket = byBadgeAndTitle.get(key);
      if (bucket) bucket.userIds.push(userId);
      else byBadgeAndTitle.set(key, { badgeCount: count, title, userIds: [userId] });
    }

    await Promise.all(
      [...byBadgeAndTitle.values()].map(({ badgeCount, title, userIds }) =>
        pushToUsers(db, userIds, {
          title,
          body,
          url: `/messages/${input.conversationId}`,
          tag: `avo-msg-${input.conversationId}`,
          icon,
          badgeCount,
          // The operator asked for a "hard" notification: the banner stays on
          // screen until it is dismissed instead of fading after a few seconds.
          requireInteraction: true,
        }),
      ),
    );
  }

  return created;
}
