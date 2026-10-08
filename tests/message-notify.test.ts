/**
 * lib/message-notify.ts — who gets told about a new message, and how.
 *
 * WHY THIS IS TESTED WITHOUT A DATABASE
 * `notifyNewMessage(db, input)` takes the Prisma client as a PARAMETER — that
 * is what lets the Socket.io server use it (see the module header). The
 * consequence is that the whole decision table can be exercised against an
 * in-memory fake, with no Postgres, no fixtures and no cleanup. That matters
 * because the decisions here are the ones users actually notice:
 *
 *   - a muted conversation must not notify (the old socket implementation
 *     notified muted members, making mute a no-op);
 *   - a blocked user must not be able to reach the person who blocked them;
 *   - a member who turned the "messages" preference off must not be told;
 *   - the sender must never be told about their own message;
 *   - the push payload must carry the right deep link and collapse tag.
 *
 * `web-push` is mocked: these tests are about what we ASK it to send, not about
 * the encrypted transport, which is the library's job.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.mock` is hoisted above every import, so the spies have to be created with
// `vi.hoisted` — a plain top-level `const` is still in the temporal dead zone
// when the factory runs.
const { sendNotification, setVapidDetails, generateVAPIDKeys } = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
  generateVAPIDKeys: vi.fn(() => ({
    publicKey: 'test-public-key',
    privateKey: 'test-private-key',
  })),
}));

vi.mock('web-push', () => ({
  default: { sendNotification, setVapidDetails, generateVAPIDKeys },
}));

import { notifyNewMessage, type NewMessageInput } from '@/lib/message-notify';

/* ------------------------------------------------------------------ */
/* Fake database                                                       */
/* ------------------------------------------------------------------ */

interface MemberSeed {
  userId: string;
  isMuted?: boolean;
  lastReadAt?: Date;
}

interface FakeSeed {
  conversation?: { id: string; type: string; title: string | null; avatarUrl: string | null } | null;
  members?: MemberSeed[];
  blocks?: { blockerId: string; blockedId: string }[];
  prefs?: { userId: string; messages: boolean }[];
  unreadByUser?: Record<string, number>;
  subscriptions?: {
    id: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    failureCount: number;
  }[];
  /** Pre-seed the VAPID pair so no generation happens. */
  vapid?: { publicKey: string; privateKey: string } | null;
}

interface FakeDb {
  conversation: { findUnique: ReturnType<typeof vi.fn> };
  conversationMember: { findMany: ReturnType<typeof vi.fn> };
  block: { findMany: ReturnType<typeof vi.fn> };
  notificationPreference: { findMany: ReturnType<typeof vi.fn> };
  notification: { create: ReturnType<typeof vi.fn> };
  message: { count: ReturnType<typeof vi.fn> };
  pushSubscription: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  systemSetting: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
}

interface Harness {
  db: FakeDb;
  createdNotifications: { userId: string; title: string | null; body: string | null }[];
  subscriptionUpdates: { id: string; failureCount: number }[];
  deletedSubscriptions: string[];
}

let notificationSeq = 0;

function makeDb(seed: FakeSeed = {}): Harness {
  const createdNotifications: Harness['createdNotifications'] = [];
  const subscriptionUpdates: Harness['subscriptionUpdates'] = [];
  const deletedSubscriptions: string[] = [];

  const db: FakeDb = {
    conversation: {
      findUnique: vi.fn(async () =>
        seed.conversation === undefined
          ? { id: 'c1', type: 'DM', title: null, avatarUrl: null }
          : seed.conversation,
      ),
    },
    conversationMember: {
      findMany: vi.fn(async () =>
        (seed.members ?? []).map((m) => ({
          userId: m.userId,
          isMuted: m.isMuted ?? false,
          lastReadAt: m.lastReadAt ?? new Date('2026-01-01T00:00:00.000Z'),
        })),
      ),
    },
    block: { findMany: vi.fn(async () => seed.blocks ?? []) },
    notificationPreference: { findMany: vi.fn(async () => seed.prefs ?? []) },
    notification: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        notificationSeq += 1;
        createdNotifications.push({
          userId: String(data.userId),
          title: (data.title as string | null) ?? null,
          body: (data.body as string | null) ?? null,
        });
        return {
          id: `n${notificationSeq}`,
          type: data.type,
          entityType: data.entityType ?? null,
          entityId: data.entityId ?? null,
          title: data.title ?? null,
          body: data.body ?? null,
          createdAt: new Date('2026-06-01T12:00:00.000Z'),
          readAt: null,
        };
      }),
    },
    message: {
      count: vi.fn(async ({ where }: { where: { senderId: { not: string } } }) => {
        const userId = where.senderId.not;
        return seed.unreadByUser?.[userId] ?? 1;
      }),
    },
    pushSubscription: {
      // Honours the `userId: { in: [...] }` filter, because that filter IS the
      // thing under test: a fan-out that ignores it would push to a muted
      // member's device, and a fake that ignores it would hide that.
      findMany: vi.fn(async ({ where }: { where: { userId: { in: string[] } } }) => {
        const wanted = new Set(where.userId.in);
        return (seed.subscriptions ?? []).filter((s) => wanted.has(s.userId));
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { failureCount: number } }) => {
        subscriptionUpdates.push({ id: where.id, failureCount: data.failureCount });
        return {};
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        deletedSubscriptions.push(where.id);
        return {};
      }),
    },
    systemSetting: {
      findUnique: vi.fn(async () =>
        seed.vapid === undefined
          ? null
          : seed.vapid === null
            ? null
            : { key: 'push.vapid', value: seed.vapid },
      ),
      create: vi.fn(async () => ({})),
    },
  };

  return { db, createdNotifications, subscriptionUpdates, deletedSubscriptions };
}

/** The VAPID pair is cached on `globalThis`; clear it so tests are independent. */
function resetVapidCache(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.__avoVapidKeys;
  delete g.__avoVapidApplied;
}

const SENDER = {
  senderId: 'user-sender',
  senderName: 'Ada Lovelace',
  senderAvatarUrl: 'https://cdn.example.com/ada.png',
};

function input(overrides: Partial<NewMessageInput> = {}): NewMessageInput {
  return {
    conversationId: 'c1',
    messageId: 'm1',
    body: 'Hello there',
    hasVoice: false,
    attachmentKinds: [],
    ...SENDER,
    ...overrides,
  };
}

/** The single subscription every push test starts from. */
const ONE_SUB = [
  {
    id: 'sub-1',
    userId: 'user-bob',
    endpoint: 'https://push.example.com/abc',
    p256dh: 'p256dh-value',
    auth: 'auth-value',
    failureCount: 0,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  resetVapidCache();
  notificationSeq = 0;
  sendNotification.mockResolvedValue({ statusCode: 201 });
});

afterEach(() => {
  resetVapidCache();
});

/* ------------------------------------------------------------------ */
/* Recipients                                                          */
/* ------------------------------------------------------------------ */

describe('notifyNewMessage — who is told', () => {
  it('tells every other member and never the sender', async () => {
    const { db, createdNotifications } = makeDb({
      members: [
        { userId: 'user-sender' },
        { userId: 'user-bob' },
        { userId: 'user-carol' },
      ],
    });

    const created = await notifyNewMessage(db as never, input());

    expect(createdNotifications.map((n) => n.userId).sort()).toEqual(['user-bob', 'user-carol']);
    expect(created.map((c) => c.userId).sort()).toEqual(['user-bob', 'user-carol']);
  });

  it('tells nobody when the sender is the only member', async () => {
    const { db, createdNotifications } = makeDb({ members: [{ userId: 'user-sender' }] });

    const created = await notifyNewMessage(db as never, input());

    expect(created).toEqual([]);
    expect(createdNotifications).toEqual([]);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('skips a muted member entirely — no row and no push', async () => {
    const { db, createdNotifications } = makeDb({
      members: [{ userId: 'user-bob', isMuted: true }, { userId: 'user-carol' }],
      subscriptions: [
        ...ONE_SUB,
        { ...ONE_SUB[0]!, id: 'sub-2', userId: 'user-carol', endpoint: 'https://push.example.com/carol' },
      ],
    });

    await notifyNewMessage(db as never, input());

    expect(createdNotifications.map((n) => n.userId)).toEqual(['user-carol']);
    // The muted member's device must not be pushed to either.
    for (const call of sendNotification.mock.calls) {
      expect((call[0] as { endpoint: string }).endpoint).not.toContain('abc');
    }
  });

  it('skips a member who blocked the sender', async () => {
    const { db, createdNotifications } = makeDb({
      members: [{ userId: 'user-bob' }, { userId: 'user-carol' }],
      blocks: [{ blockerId: 'user-bob', blockedId: 'user-sender' }],
    });

    await notifyNewMessage(db as never, input());

    expect(createdNotifications.map((n) => n.userId)).toEqual(['user-carol']);
  });

  it('skips a member the sender blocked', async () => {
    const { db, createdNotifications } = makeDb({
      members: [{ userId: 'user-bob' }, { userId: 'user-carol' }],
      blocks: [{ blockerId: 'user-sender', blockedId: 'user-bob' }],
    });

    await notifyNewMessage(db as never, input());

    expect(createdNotifications.map((n) => n.userId)).toEqual(['user-carol']);
  });

  it('skips a member who turned the messages preference off', async () => {
    const { db, createdNotifications } = makeDb({
      members: [{ userId: 'user-bob' }, { userId: 'user-carol' }],
      prefs: [
        { userId: 'user-bob', messages: false },
        { userId: 'user-carol', messages: true },
      ],
    });

    await notifyNewMessage(db as never, input());

    expect(createdNotifications.map((n) => n.userId)).toEqual(['user-carol']);
  });

  it('returns nothing when the conversation does not exist', async () => {
    const { db, createdNotifications } = makeDb({ conversation: null });

    const created = await notifyNewMessage(db as never, input());

    expect(created).toEqual([]);
    expect(createdNotifications).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

describe('notifyNewMessage — the text', () => {
  it('uses the sender name as the title of a direct message', async () => {
    const { db, createdNotifications } = makeDb({
      conversation: { id: 'c1', type: 'DM', title: null, avatarUrl: null },
      members: [{ userId: 'user-bob' }],
    });

    await notifyNewMessage(db as never, input());

    expect(createdNotifications[0]!.title).toBe('Ada Lovelace');
    expect(createdNotifications[0]!.body).toBe('Hello there');
  });

  it('names the group as well, for a group conversation', async () => {
    const { db, createdNotifications } = makeDb({
      conversation: { id: 'c1', type: 'GROUP', title: 'Design Team', avatarUrl: null },
      members: [{ userId: 'user-bob' }],
    });

    await notifyNewMessage(db as never, input());

    expect(createdNotifications[0]!.title).toBe('Ada Lovelace · Design Team');
  });

  it('falls back to "Group" when a group has no title', async () => {
    const { db, createdNotifications } = makeDb({
      conversation: { id: 'c1', type: 'GROUP', title: '   ', avatarUrl: null },
      members: [{ userId: 'user-bob' }],
    });

    await notifyNewMessage(db as never, input());

    expect(createdNotifications[0]!.title).toBe('Ada Lovelace · Group');
  });

  it.each([
    [{ body: null, hasVoice: true, attachmentKinds: [] }, '🎤 Voice message'],
    [{ body: null, hasVoice: false, attachmentKinds: ['IMAGE'] }, '📷 Photo'],
    [{ body: null, hasVoice: false, attachmentKinds: ['VIDEO'] }, '🎥 Video'],
    [{ body: null, hasVoice: false, attachmentKinds: ['FILE'] }, '📎 Attachment'],
    [{ body: null, hasVoice: false, attachmentKinds: [] }, 'Sent a message'],
    [{ body: '   ', hasVoice: false, attachmentKinds: [] }, 'Sent a message'],
  ])('describes a message with no text as %j', async (overrides, expected) => {
    const { db, createdNotifications } = makeDb({ members: [{ userId: 'user-bob' }] });

    await notifyNewMessage(db as never, input(overrides as Partial<NewMessageInput>));

    expect(createdNotifications[0]!.body).toBe(expected);
  });

  it('prefers the text over the attachment description', async () => {
    const { db, createdNotifications } = makeDb({ members: [{ userId: 'user-bob' }] });

    await notifyNewMessage(
      db as never,
      input({ body: 'look at this', attachmentKinds: ['IMAGE'] }),
    );

    expect(createdNotifications[0]!.body).toBe('look at this');
  });

  it('truncates a long body to one line with an ellipsis', async () => {
    const { db, createdNotifications } = makeDb({ members: [{ userId: 'user-bob' }] });

    await notifyNewMessage(db as never, input({ body: 'x'.repeat(500) }));

    const body = createdNotifications[0]!.body!;
    expect(body).toHaveLength(140);
    expect(body.endsWith('…')).toBe(true);
  });

  it('keeps a body of exactly the limit untouched', async () => {
    const { db, createdNotifications } = makeDb({ members: [{ userId: 'user-bob' }] });

    await notifyNewMessage(db as never, input({ body: 'y'.repeat(140) }));

    expect(createdNotifications[0]!.body).toBe('y'.repeat(140));
  });

  it('stores the conversation as the routable entity', async () => {
    const { db } = makeDb({ members: [{ userId: 'user-bob' }] });

    const created = await notifyNewMessage(db as never, input());

    expect(created[0]!.notification.entityType).toBe('conversation');
    expect(created[0]!.notification.entityId).toBe('c1');
  });
});

/* ------------------------------------------------------------------ */
/* Push payload                                                        */
/* ------------------------------------------------------------------ */

describe('notifyNewMessage — the push', () => {
  it('pushes a deep link, a collapse tag and requireInteraction', async () => {
    const { db } = makeDb({ members: [{ userId: 'user-bob' }], subscriptions: ONE_SUB });

    await notifyNewMessage(db as never, input());

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [subscription, rawBody, options] = sendNotification.mock.calls[0]!;
    expect((subscription as { endpoint: string }).endpoint).toBe('https://push.example.com/abc');
    expect((options as { urgency: string }).urgency).toBe('high');

    const payload = JSON.parse(rawBody as string);
    expect(payload.url).toBe('/messages/c1');
    expect(payload.tag).toBe('avo-msg-c1');
    expect(payload.title).toBe('Ada Lovelace');
    expect(payload.requireInteraction).toBe(true);
  });

  it('sends the unread count as the app badge', async () => {
    const { db } = makeDb({
      members: [{ userId: 'user-bob' }],
      subscriptions: ONE_SUB,
      unreadByUser: { 'user-bob': 7 },
    });

    await notifyNewMessage(db as never, input());

    const payload = JSON.parse(sendNotification.mock.calls[0]![1] as string);
    expect(payload.badgeCount).toBe(7);
  });

  it('groups recipients that share an unread count into one push call', async () => {
    const { db } = makeDb({
      members: [{ userId: 'user-bob' }, { userId: 'user-carol' }],
      subscriptions: [
        ...ONE_SUB,
        { ...ONE_SUB[0]!, id: 'sub-2', userId: 'user-carol', endpoint: 'https://push.example.com/carol' },
      ],
      unreadByUser: { 'user-bob': 3, 'user-carol': 3 },
    });

    await notifyNewMessage(db as never, input());

    // Two subscriptions, one fan-out: both recipients share a badge count.
    expect(db.pushSubscription.findMany).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  it('separates recipients with different unread counts', async () => {
    const { db } = makeDb({
      members: [{ userId: 'user-bob' }, { userId: 'user-carol' }],
      subscriptions: [
        ...ONE_SUB,
        { ...ONE_SUB[0]!, id: 'sub-2', userId: 'user-carol', endpoint: 'https://push.example.com/carol' },
      ],
      unreadByUser: { 'user-bob': 3, 'user-carol': 9 },
    });

    await notifyNewMessage(db as never, input());

    expect(db.pushSubscription.findMany).toHaveBeenCalledTimes(2);
    const badges = sendNotification.mock.calls.map(
      (call) => JSON.parse(call[1] as string).badgeCount as number,
    );
    expect(badges.sort()).toEqual([3, 9]);
  });

  it('uses the group picture as the icon for a group', async () => {
    const { db } = makeDb({
      conversation: {
        id: 'c1',
        type: 'GROUP',
        title: 'Design Team',
        avatarUrl: 'https://cdn.example.com/group.png',
      },
      members: [{ userId: 'user-bob' }],
      subscriptions: ONE_SUB,
    });

    await notifyNewMessage(db as never, input());

    const payload = JSON.parse(sendNotification.mock.calls[0]![1] as string);
    expect(payload.icon).toBe('https://cdn.example.com/group.png');
  });

  it('uses the sender avatar for a direct message', async () => {
    const { db } = makeDb({
      conversation: { id: 'c1', type: 'DM', title: null, avatarUrl: 'https://cdn.example.com/group.png' },
      members: [{ userId: 'user-bob' }],
      subscriptions: ONE_SUB,
    });

    await notifyNewMessage(db as never, input());

    const payload = JSON.parse(sendNotification.mock.calls[0]![1] as string);
    expect(payload.icon).toBe('https://cdn.example.com/ada.png');
  });

  it('does not push when no recipient has a subscription', async () => {
    const { db, createdNotifications } = makeDb({
      members: [{ userId: 'user-bob' }],
      subscriptions: [],
    });

    await notifyNewMessage(db as never, input());

    // The in-app notification still exists — push is an extra, not a substitute.
    expect(createdNotifications).toHaveLength(1);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Failure handling                                                    */
/* ------------------------------------------------------------------ */

describe('notifyNewMessage — failure handling', () => {
  it('deletes a subscription the push service reports as gone', async () => {
    const { db, deletedSubscriptions } = makeDb({
      members: [{ userId: 'user-bob' }],
      subscriptions: ONE_SUB,
    });
    sendNotification.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));

    await notifyNewMessage(db as never, input());

    expect(deletedSubscriptions).toEqual(['sub-1']);
  });

  it('deletes a 404 subscription too', async () => {
    const { db, deletedSubscriptions } = makeDb({
      members: [{ userId: 'user-bob' }],
      subscriptions: ONE_SUB,
    });
    sendNotification.mockRejectedValue(Object.assign(new Error('missing'), { statusCode: 404 }));

    await notifyNewMessage(db as never, input());

    expect(deletedSubscriptions).toEqual(['sub-1']);
  });

  it('counts a transient failure instead of deleting the subscription', async () => {
    const { db, subscriptionUpdates, deletedSubscriptions } = makeDb({
      members: [{ userId: 'user-bob' }],
      subscriptions: ONE_SUB,
    });
    sendNotification.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }));

    await notifyNewMessage(db as never, input());

    expect(deletedSubscriptions).toEqual([]);
    expect(subscriptionUpdates).toEqual([{ id: 'sub-1', failureCount: 1 }]);
  });

  it('gives up on a subscription that keeps failing', async () => {
    const { db, deletedSubscriptions } = makeDb({
      members: [{ userId: 'user-bob' }],
      subscriptions: [{ ...ONE_SUB[0]!, failureCount: 4 }],
    });
    sendNotification.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }));

    await notifyNewMessage(db as never, input());

    expect(deletedSubscriptions).toEqual(['sub-1']);
  });

  it('never rejects, even when the push service throws', async () => {
    const { db, createdNotifications } = makeDb({
      members: [{ userId: 'user-bob' }],
      subscriptions: ONE_SUB,
    });
    sendNotification.mockRejectedValue(new Error('network down'));

    await expect(notifyNewMessage(db as never, input())).resolves.toBeDefined();
    expect(createdNotifications).toHaveLength(1);
  });

  it('keeps notifying the remaining recipients when one insert fails', async () => {
    const { db, createdNotifications } = makeDb({
      members: [{ userId: 'user-bob' }, { userId: 'user-carol' }],
    });
    db.notification.create.mockImplementationOnce(async () => {
      throw new Error('insert failed');
    });

    await notifyNewMessage(db as never, input());

    expect(createdNotifications.map((n) => n.userId)).toEqual(['user-carol']);
  });
});

/* ------------------------------------------------------------------ */
/* VAPID keys                                                          */
/* ------------------------------------------------------------------ */

describe('notifyNewMessage — VAPID keys', () => {
  it('generates and persists a key pair on first use', async () => {
    const { db } = makeDb({ members: [{ userId: 'user-bob' }], subscriptions: ONE_SUB, vapid: null });

    await notifyNewMessage(db as never, input());

    expect(generateVAPIDKeys).toHaveBeenCalledTimes(1);
    expect(db.systemSetting.create).toHaveBeenCalledWith({
      data: {
        key: 'push.vapid',
        value: { publicKey: 'test-public-key', privateKey: 'test-private-key' },
      },
    });
    expect(setVapidDetails).toHaveBeenCalledWith(
      expect.any(String),
      'test-public-key',
      'test-private-key',
    );
  });

  it('reuses a stored key pair rather than generating a new one', async () => {
    const { db } = makeDb({
      members: [{ userId: 'user-bob' }],
      subscriptions: ONE_SUB,
      vapid: { publicKey: 'stored-public', privateKey: 'stored-private' },
    });

    await notifyNewMessage(db as never, input());

    expect(generateVAPIDKeys).not.toHaveBeenCalled();
    expect(setVapidDetails).toHaveBeenCalledWith(expect.any(String), 'stored-public', 'stored-private');
  });

  it('prefers the environment pair when it is set', async () => {
    process.env.VAPID_PUBLIC_KEY = 'env-public';
    process.env.VAPID_PRIVATE_KEY = 'env-private';
    try {
      const { db } = makeDb({ members: [{ userId: 'user-bob' }], subscriptions: ONE_SUB, vapid: null });

      await notifyNewMessage(db as never, input());

      expect(generateVAPIDKeys).not.toHaveBeenCalled();
      expect(db.systemSetting.create).not.toHaveBeenCalled();
      expect(setVapidDetails).toHaveBeenCalledWith(expect.any(String), 'env-public', 'env-private');
    } finally {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
    }
  });

  it('still writes the notification when keys cannot be resolved at all', async () => {
    const { db, createdNotifications } = makeDb({
      members: [{ userId: 'user-bob' }],
      subscriptions: ONE_SUB,
      vapid: null,
    });
    db.systemSetting.create.mockRejectedValue(new Error('db down'));
    db.systemSetting.findUnique.mockResolvedValue(null);
    generateVAPIDKeys.mockImplementationOnce(() => {
      throw new Error('no crypto');
    });

    await expect(notifyNewMessage(db as never, input())).resolves.toBeDefined();

    // The in-app notification is the part that must not be lost.
    expect(createdNotifications).toHaveLength(1);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* The VAPID subject                                                   */
/* ------------------------------------------------------------------ */

/**
 * `web-push` throws from `setVapidDetails` when the subject is not an `https:`
 * or `mailto:` URL, and that throw is caught by design — so a bad subject
 * disables push with NO visible error. `.env` ships
 * `APP_URL="http://localhost:3000"`, which is exactly such a value, so this is
 * the difference between the feature working and silently doing nothing.
 */
describe('the VAPID subject claim', () => {
  const ENV_KEYS = ['VAPID_SUBJECT', 'APP_URL', 'SMTP_FROM', 'SMTP_USER'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const key of ENV_KEYS) delete process.env[key];
    resetVapidCache();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  async function subjectFor(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
    Object.assign(process.env, env);
    resetVapidCache();
    const { db } = makeDb({ members: [{ userId: 'user-bob' }], subscriptions: ONE_SUB, vapid: null });
    await notifyNewMessage(db as never, input());
    expect(setVapidDetails).toHaveBeenCalled();
    return setVapidDetails.mock.calls.at(-1)![0] as string;
  }

  it('uses an explicit VAPID_SUBJECT', async () => {
    expect(await subjectFor({ VAPID_SUBJECT: 'https://avomessage.app' })).toBe(
      'https://avomessage.app',
    );
  });

  it('uses an https APP_URL', async () => {
    expect(await subjectFor({ APP_URL: 'https://avomessage.vercel.app' })).toBe(
      'https://avomessage.vercel.app',
    );
  });

  it('REFUSES an http APP_URL and falls back to a mailbox', async () => {
    // This is the development default in .env — using it would break every push.
    const subject = await subjectFor({ APP_URL: 'http://localhost:3000' });
    expect(subject.startsWith('mailto:')).toBe(true);
    expect(subject).not.toContain('localhost');
  });

  it('refuses a non-URL VAPID_SUBJECT too, rather than passing it through', async () => {
    const subject = await subjectFor({ VAPID_SUBJECT: 'http://nope.example', APP_URL: 'https://ok.example' });
    expect(subject).toBe('https://ok.example');
  });

  it('prefers a real mailbox from SMTP_FROM', async () => {
    expect(
      await subjectFor({ APP_URL: 'http://localhost:3000', SMTP_FROM: 'AvoMessage <hello@avorex.com>' }),
    ).toBe('mailto:hello@avorex.com');
  });

  it('uses a bare SMTP_USER address', async () => {
    expect(await subjectFor({ SMTP_USER: 'bot@avorex.com' })).toBe('mailto:bot@avorex.com');
  });

  it('falls back to a placeholder mailbox when nothing usable is configured', async () => {
    expect(await subjectFor({})).toBe('mailto:noreply@avomessage.app');
  });
});
