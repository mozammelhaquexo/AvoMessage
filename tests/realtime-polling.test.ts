/**
 * tests/realtime-polling.test.ts — the REST polling transport.
 *
 * Why this file exists: on a serverless host `/socket.io` never answers, so
 * `lib/realtime/polling.ts` is the ONLY thing keeping chat, receipts,
 * notifications and presence alive on the deployed app. Its logic is a pile of
 * diffs against snapshots, which is exactly the kind of code that is easy to
 * get subtly wrong and hard to notice — a missed diff is a message that never
 * appears, and a spurious one is a message that appears twice.
 *
 * Everything the transport touches is injected (REST, timers, visibility), so
 * these tests run in plain Node with no DOM and no real network.
 */

import { describe, expect, it, vi } from 'vitest';

import type { RealtimeSocket } from '@/lib/realtime/contract';
import { ClientToServer, ServerToClient } from '@/lib/realtime/events';
import { createPollingSocket, type PollingRest } from '@/lib/realtime/polling';
import {
  createRealtimeSocket,
  resolveTransportPreference,
} from '@/lib/realtime/transport';

// ─────────────────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

interface Call {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

interface Store {
  messages: Map<string, Rec[]>;
  members: Map<string, Rec[]>;
  conversationList: Rec[];
  notifications: Rec[];
  /** Set to make the next message POST reject. */
  postError?: unknown;
  nextMessageId: string;
}

interface Harness {
  socket: RealtimeSocket;
  store: Store;
  calls: Call[];
  /** Let already-started work (the tick fired by `connect`) finish. */
  settle: () => Promise<void>;
  /** Fire the interval callbacks once, then let their work finish. */
  tick: () => Promise<void>;
}

/** Drain the microtask queue — no real timers are involved. */
async function settle(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function createStore(): Store {
  return {
    messages: new Map(),
    members: new Map(),
    conversationList: [],
    notifications: [],
    nextMessageId: 'msg-new',
  };
}

/**
 * A fake REST layer that answers the exact paths the transport requests, and
 * records every call so the tests can assert on the wire format.
 */
function createRest(store: Store, calls: Call[]): PollingRest {
  const match = (path: string, pattern: RegExp): string | null => {
    const result = pattern.exec(path);
    return result ? decodeURIComponent(result[1]) : null;
  };

  return {
    async get<T>(path: string): Promise<T> {
      calls.push({ method: 'GET', path });

      if (path.startsWith('/api/notifications')) {
        return {
          data: store.notifications,
          unreadCount: store.notifications.length,
        } as unknown as T;
      }
      if (path.startsWith('/api/conversations?')) {
        return { data: store.conversationList } as unknown as T;
      }

      const forMessages = match(path, /^\/api\/conversations\/([^/?]+)\/messages/);
      if (forMessages) {
        return { data: store.messages.get(forMessages) ?? [] } as unknown as T;
      }

      const forDetail = match(path, /^\/api\/conversations\/([^/?]+)$/);
      if (forDetail) {
        return {
          id: forDetail,
          members: store.members.get(forDetail) ?? [],
        } as unknown as T;
      }

      throw new Error(`unexpected GET ${path}`);
    },

    async post<T>(path: string, body?: unknown): Promise<T> {
      calls.push({ method: 'POST', path, body });

      if (path === '/api/presence') return {} as T;

      const forMessages = match(path, /^\/api\/conversations\/([^/?]+)\/messages$/);
      if (forMessages) {
        if (store.postError) throw store.postError;
        const created = {
          id: store.nextMessageId,
          conversationId: forMessages,
          body: (body as { body?: string } | undefined)?.body ?? null,
          type: 'TEXT',
          createdAt: '2026-10-04T12:00:00.000Z',
          editedAt: null,
          deleted: false,
        };
        // Mirror real persistence: the next poll must find it in the thread.
        store.messages.set(forMessages, [
          created,
          ...(store.messages.get(forMessages) ?? []),
        ]);
        return { message: created } as unknown as T;
      }

      return {} as T;
    },
  };
}

function createHarness(): Harness {
  const store = createStore();
  const calls: Call[] = [];
  const tasks = new Map<number, () => void>();
  let nextTimerId = 1;

  const socket = createPollingSocket({
    rest: createRest(store, calls),
    isHidden: () => false,
    setTimer: (fn: () => void) => {
      const id = nextTimerId;
      nextTimerId += 1;
      tasks.set(id, fn);
      return id;
    },
    clearTimer: (handle: unknown) => {
      tasks.delete(handle as number);
    },
  });

  return {
    socket,
    store,
    calls,
    settle: () => settle(),
    async tick() {
      for (const fn of [...tasks.values()]) fn();
      await settle();
    },
  };
}

/** Subscribe and collect every payload the transport emits for an event. */
function collect(socket: RealtimeSocket, event: string): Rec[] {
  const seen: Rec[] = [];
  socket.on(event, (payload: Rec) => {
    seen.push(payload);
  });
  return seen;
}

function msg(id: string, overrides: Rec = {}): Rec {
  return {
    id,
    conversationId: 'c1',
    body: `body-${id}`,
    type: 'TEXT',
    createdAt: '2026-10-04T10:00:00.000Z',
    editedAt: null,
    deleted: false,
    ...overrides,
  };
}

const ids = (seen: Rec[]): string[] =>
  seen.map((p) => (p.message as Rec).id as string);

const pathsOf = (calls: Call[], method: Call['method']): string[] =>
  calls.filter((c) => c.method === method).map((c) => c.path);

// ─────────────────────────────────────────────────────────────────────────────
// Preference resolution
// ─────────────────────────────────────────────────────────────────────────────

describe('transport preference', () => {
  it('defaults to auto, and reads the env override case-insensitively', () => {
    expect(resolveTransportPreference(undefined)).toBe('auto');
    expect(resolveTransportPreference('')).toBe('auto');
    expect(resolveTransportPreference('auto')).toBe('auto');
    expect(resolveTransportPreference('  POLL ')).toBe('poll');
    expect(resolveTransportPreference('polling')).toBe('poll');
    expect(resolveTransportPreference('socket')).toBe('socket');
    expect(resolveTransportPreference('socket.io')).toBe('socket');
    expect(resolveTransportPreference('nonsense')).toBe('auto');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────────────────

describe('polling transport — messages', () => {
  it('announces the visible page on the first poll, then only additions', async () => {
    const h = createHarness();
    const arrivals = collect(h.socket, ServerToClient.MESSAGE_NEW);

    // History already exists when the thread opens. The transport announces it
    // anyway: `ChatWindow` merges history and live by message id, so a
    // redundant announcement is deduped, while a silent baseline pass can lose
    // a message for good. See the `pollMessages` doc comment.
    h.store.messages.set('c1', [msg('m0')]);
    h.socket.emit(ClientToServer.CONVERSATION_JOIN, { conversationId: 'c1' });
    h.socket.connect();
    await h.settle();
    expect(ids(arrivals)).toEqual(['m0']);

    // Two new messages arrive; the API is newest-first, the UI appends.
    h.store.messages.set('c1', [msg('m2'), msg('m1'), msg('m0')]);
    await h.tick();
    expect(ids(arrivals)).toEqual(['m0', 'm1', 'm2']);
  });

  it('does not lose a message that arrived before the first poll of a thread', async () => {
    const h = createHarness();
    const arrivals = collect(h.socket, ServerToClient.MESSAGE_NEW);

    // Already connected and polling other rooms — the thread is opened later,
    // which is what navigating to /messages/:id does.
    h.socket.connect();
    await h.settle();

    h.socket.emit(ClientToServer.CONVERSATION_JOIN, { conversationId: 'c1' });
    // A message from another client lands AFTER the thread's own REST history
    // read returned but BEFORE this conversation's first poll. A baseline pass
    // would record it without announcing it, and every later poll would see it
    // unchanged and stay silent — the message would never appear.
    h.store.messages.set('c1', [msg('m1')]);

    await h.tick();
    await h.tick();

    expect(ids(arrivals)).toEqual(['m1']);
  });

  it('announces an edit as message:updated, not as a new message', async () => {
    const h = createHarness();
    const arrivals = collect(h.socket, ServerToClient.MESSAGE_NEW);
    const edits = collect(h.socket, ServerToClient.MESSAGE_UPDATED);

    h.store.messages.set('c1', [msg('m1')]);
    h.socket.emit(ClientToServer.CONVERSATION_JOIN, { conversationId: 'c1' });
    h.socket.connect();
    await h.settle();
    // The first pass announces m1 once — the edit below must not announce it
    // again as a second new message.
    expect(ids(arrivals)).toEqual(['m1']);

    h.store.messages.set('c1', [
      msg('m1', { body: 'edited', editedAt: '2026-10-04T11:00:00.000Z' }),
    ]);
    await h.tick();

    expect(ids(arrivals)).toEqual(['m1']);
    expect(edits).toEqual([
      {
        messageId: 'm1',
        body: 'edited',
        editedAt: '2026-10-04T11:00:00.000Z',
      },
    ]);
  });

  it('announces a soft delete as message:deleted', async () => {
    const h = createHarness();
    const deletes = collect(h.socket, ServerToClient.MESSAGE_DELETED);

    h.store.messages.set('c1', [msg('m1')]);
    h.socket.emit(ClientToServer.CONVERSATION_JOIN, { conversationId: 'c1' });
    h.socket.connect();
    await h.settle();

    h.store.messages.set('c1', [msg('m1', { deleted: true, body: null })]);
    await h.tick();

    expect(deletes).toEqual([{ messageId: 'm1' }]);
  });

  it('re-stamps conversationId on a tombstone, which REST leaves empty', async () => {
    const h = createHarness();
    const arrivals = collect(h.socket, ServerToClient.MESSAGE_NEW);

    h.socket.emit(ClientToServer.CONVERSATION_JOIN, { conversationId: 'c1' });
    h.socket.connect();
    await h.settle();

    // `messageTombstone()` in lib/services/serialize.ts builds deleted
    // messages with conversationId: "". `useConversation` drops any
    // `message:new` whose conversationId does not match the open thread, so
    // without the re-stamp a message created and deleted between two polls
    // would silently vanish.
    h.store.messages.set('c1', [
      { ...msg('m9'), conversationId: '', deleted: true, body: null },
    ]);
    await h.tick();

    expect(arrivals).toHaveLength(1);
    expect((arrivals[0].message as Rec).conversationId).toBe('c1');
  });

  it('does not re-announce a message it already knows about', async () => {
    const h = createHarness();
    const arrivals = collect(h.socket, ServerToClient.MESSAGE_NEW);

    h.store.messages.set('c1', [msg('m1')]);
    h.socket.emit(ClientToServer.CONVERSATION_JOIN, { conversationId: 'c1' });
    h.socket.connect();
    await h.settle();

    // Three polls with an unchanged thread: m1 is announced exactly once.
    await h.tick();
    await h.tick();
    await h.tick();

    expect(ids(arrivals)).toEqual(['m1']);
  });

  it('stops polling a conversation once it is left', async () => {
    const h = createHarness();

    h.socket.emit(ClientToServer.CONVERSATION_JOIN, { conversationId: 'c1' });
    h.socket.connect();
    await h.settle();
    expect(pathsOf(h.calls, 'GET')).toContain('/api/conversations/c1/messages?limit=50');

    h.calls.length = 0;
    h.socket.emit(ClientToServer.CONVERSATION_LEAVE, { conversationId: 'c1' });
    await h.tick();

    expect(
      pathsOf(h.calls, 'GET').some((p) => p.startsWith('/api/conversations/c1/messages')),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sending
// ─────────────────────────────────────────────────────────────────────────────

describe('polling transport — sending', () => {
  it('posts the message with the same clientId the socket path sends, and acks it', async () => {
    const h = createHarness();
    const ack = vi.fn();

    h.socket.emit(ClientToServer.CONVERSATION_JOIN, { conversationId: 'c1' });
    h.socket.connect();
    await h.settle();
    h.calls.length = 0;

    h.socket.emit(
      ClientToServer.MESSAGE_SEND,
      {
        conversationId: 'c1',
        clientId: 'client-abcdef12',
        body: 'hello there',
        type: 'TEXT',
      },
      ack,
    );
    await h.settle();

    const post = h.calls.find(
      (c) => c.method === 'POST' && c.path.endsWith('/messages'),
    );
    expect(post?.path).toBe('/api/conversations/c1/messages');
    expect(post?.body).toEqual({
      body: 'hello there',
      type: 'TEXT',
      clientId: 'client-abcdef12',
      replyToId: undefined,
      forwardedFromId: undefined,
      attachments: undefined,
    });
    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack.mock.calls[0][0]).toMatchObject({
      ok: true,
      message: { id: 'msg-new', conversationId: 'c1', body: 'hello there' },
    });
  });

  it('does not echo a message it just sent back to the sender', async () => {
    const h = createHarness();
    const arrivals = collect(h.socket, ServerToClient.MESSAGE_NEW);

    h.socket.emit(ClientToServer.CONVERSATION_JOIN, { conversationId: 'c1' });
    h.socket.connect();
    await h.settle();

    h.socket.emit(
      ClientToServer.MESSAGE_SEND,
      { conversationId: 'c1', clientId: 'client-abcdef12', body: 'hi' },
      vi.fn(),
    );
    await h.settle();

    // The fake POST persisted it, so the next poll sees it as a known id.
    await h.tick();
    await h.tick();

    expect(arrivals).toHaveLength(0);
  });

  it('reports a failed send through the ack instead of throwing', async () => {
    const h = createHarness();
    const ack = vi.fn();
    h.store.postError = Object.assign(new Error('slow down'), {
      code: 'RATE_LIMITED',
    });

    h.socket.emit(
      ClientToServer.MESSAGE_SEND,
      { conversationId: 'c1', clientId: 'client-abcdef12', body: 'hi' },
      ack,
    );
    await h.settle();

    expect(ack).toHaveBeenCalledWith({
      ok: false,
      code: 'RATE_LIMITED',
      message: 'slow down',
    });
  });

  it('rejects a send with no conversationId without calling the API', async () => {
    const h = createHarness();
    const ack = vi.fn();

    h.socket.emit(ClientToServer.MESSAGE_SEND, { body: 'nowhere' }, ack);
    await h.settle();

    expect(ack).toHaveBeenCalledWith({ ok: false, code: 'VALIDATION_ERROR' });
    expect(pathsOf(h.calls, 'POST')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Receipts, badges, notifications, presence
// ─────────────────────────────────────────────────────────────────────────────

describe('polling transport — receipts and badges', () => {
  it('emits message:read when another member advances lastReadAt', async () => {
    const h = createHarness();
    const reads = collect(h.socket, ServerToClient.MESSAGE_READ);

    h.store.members.set('c1', [
      { user: { id: 'u2' }, lastReadAt: '2026-10-04T10:00:00.000Z' },
    ]);
    h.socket.emit(ClientToServer.CONVERSATION_JOIN, { conversationId: 'c1' });
    h.socket.connect();
    await h.settle();

    // First sighting is a baseline, not an advance.
    expect(reads).toHaveLength(0);

    h.store.members.set('c1', [
      { user: { id: 'u2' }, lastReadAt: '2026-10-04T10:05:00.000Z' },
    ]);
    // Receipts come from the heaviest endpoint, so they ride every other tick.
    await h.tick();
    expect(reads).toHaveLength(0);
    await h.tick();

    expect(reads).toEqual([
      {
        conversationId: 'c1',
        userId: 'u2',
        lastReadAt: '2026-10-04T10:05:00.000Z',
      },
    ]);
  });

  it('polls the read-receipt endpoint less often than messages', async () => {
    const h = createHarness();

    h.store.members.set('c1', [
      { user: { id: 'u2' }, lastReadAt: '2026-10-04T10:00:00.000Z' },
    ]);
    h.socket.emit(ClientToServer.CONVERSATION_JOIN, { conversationId: 'c1' });
    h.socket.connect();
    await h.settle();
    h.calls.length = 0;

    await h.tick();
    await h.tick();
    await h.tick();
    await h.tick();
    await h.tick();
    await h.tick();

    const detail = pathsOf(h.calls, 'GET').filter((p) => p === '/api/conversations/c1').length;
    const messages = pathsOf(h.calls, 'GET').filter((p) => p.includes('/messages')).length;

    // Over 6 ticks: messages on every tick, the heavy detail call on half.
    expect(messages).toBe(6);
    expect(detail).toBe(3);
  });

  it('emits conversation:updated when an unread count changes', async () => {
    const h = createHarness();
    const updates = collect(h.socket, ServerToClient.CONVERSATION_UPDATED);

    h.store.conversationList = [{ id: 'c1', unreadCount: 0 }];
    h.socket.connect();
    await h.settle();

    // The list is the heaviest poll, so it runs on every other tick.
    h.store.conversationList = [{ id: 'c1', unreadCount: 3 }];
    await h.tick();
    await h.tick();

    expect(updates).toEqual([
      { conversationId: 'c1', lastMessageAt: undefined, messageId: undefined, unreadCount: 3 },
    ]);
  });

  it('emits conversation:updated when only the row tail moves', async () => {
    const h = createHarness();
    const updates = collect(h.socket, ServerToClient.CONVERSATION_UPDATED);

    h.store.conversationList = [
      { id: 'c1', unreadCount: 0, lastMessageAt: '2026-10-04T10:00:00.000Z' },
    ];
    h.socket.connect();
    await h.settle();

    // A message that does NOT move the unread count — your own, sent from
    // another tab, or one read as it arrived. The socket server emits on every
    // message, and its payload carries `lastMessageAt` for exactly this; a
    // diff that watched only `unreadCount` would leave the row's preview
    // showing the previous message for the rest of the session.
    h.store.conversationList = [
      {
        id: 'c1',
        unreadCount: 0,
        lastMessageAt: '2026-10-04T10:05:00.000Z',
        lastMessage: { id: 'm9' },
      },
    ];
    await h.tick();
    await h.tick();

    expect(updates).toEqual([
      {
        conversationId: 'c1',
        lastMessageAt: '2026-10-04T10:05:00.000Z',
        messageId: 'm9',
        unreadCount: 0,
      },
    ]);
  });

  it('announces a conversation that appears while the list was empty', async () => {
    const h = createHarness();
    const updates = collect(h.socket, ServerToClient.CONVERSATION_UPDATED);

    // An account in no conversations at all. The seeded snapshot is therefore
    // EMPTY — which is a perfectly valid state and must not be mistaken for
    // "we have never polled the list". Treating it that way meant the guard
    // re-armed on every poll, so a conversation appearing for the first time
    // with its tail already set was never announced: measured against the live
    // API at the real 6 s cadence, zero events and a row frozen on
    // "No messages yet".
    h.store.conversationList = [];
    h.socket.connect();
    await h.settle();

    h.store.conversationList = [
      {
        id: 'c1',
        unreadCount: 0,
        lastMessageAt: '2026-10-04T10:05:00.000Z',
        lastMessage: { id: 'm1' },
      },
    ];
    await h.tick();
    await h.tick();
    await h.tick();

    expect(updates).toEqual([
      {
        conversationId: 'c1',
        lastMessageAt: '2026-10-04T10:05:00.000Z',
        messageId: 'm1',
        unreadCount: 0,
      },
    ]);
  });

  it('announces a conversation first seen with its tail already set', async () => {
    const h = createHarness();
    const updates = collect(h.socket, ServerToClient.CONVERSATION_UPDATED);

    // Seeded without the conversation.
    h.store.conversationList = [
      { id: 'other', unreadCount: 0, lastMessageAt: '2026-10-04T10:00:00.000Z' },
    ];
    h.socket.connect();
    await h.settle();

    // The conversation appears for the FIRST time already carrying a message.
    // This is the ordering the live 6 s list cadence produces constantly: the
    // thread is opened, a message lands, and the poller's first sighting of the
    // row is the next list poll. Skipping unknown rows left the preview stuck
    // on "No messages yet" with no later poll able to correct it, because
    // nothing about the row changes again.
    h.store.conversationList = [
      { id: 'other', unreadCount: 0, lastMessageAt: '2026-10-04T10:00:00.000Z' },
      {
        id: 'c1',
        unreadCount: 0,
        lastMessageAt: '2026-10-04T10:05:00.000Z',
        lastMessage: { id: 'm1' },
      },
    ];
    await h.tick();
    await h.tick();
    await h.tick();

    expect(updates).toEqual([
      {
        conversationId: 'c1',
        lastMessageAt: '2026-10-04T10:05:00.000Z',
        messageId: 'm1',
        unreadCount: 0,
      },
    ]);
  });

  it('seeds notifications silently, then announces only genuinely new ones', async () => {
    const h = createHarness();
    const arrivals = collect(h.socket, ServerToClient.NOTIFICATION_NEW);

    h.store.notifications = [{ id: 'n1' }];
    h.socket.connect();
    await h.settle();
    expect(arrivals).toHaveLength(0);

    // API order is newest-first.
    h.store.notifications = [{ id: 'n3' }, { id: 'n2' }, { id: 'n1' }];
    await h.tick();

    expect(arrivals.map((n) => n.id)).toEqual(['n2', 'n3']);
  });
});

describe('polling transport — presence', () => {
  it('publishes ONLINE on connect, then whatever the client asks for', async () => {
    const h = createHarness();

    h.socket.connect();
    await h.settle();

    const onConnect = h.calls.filter((c) => c.path === '/api/presence');
    expect(onConnect).toHaveLength(1);
    expect(onConnect[0].body).toEqual({ status: 'ONLINE' });

    h.calls.length = 0;
    h.socket.emit(ClientToServer.PRESENCE_UPDATE, { status: 'DO_NOT_DISTURB' });
    await h.settle();

    expect(h.calls.find((c) => c.path === '/api/presence')?.body).toEqual({
      status: 'DO_NOT_DISTURB',
    });
  });

  it('sends an empty body for a heartbeat, so the status is preserved', async () => {
    const h = createHarness();

    h.socket.connect();
    await h.settle();
    h.calls.length = 0;

    // `usePublishPresence(null)` emits no status: touch lastSeenAt, keep status.
    h.socket.emit(ClientToServer.PRESENCE_UPDATE, {});
    await h.settle();

    expect(h.calls.find((c) => c.path === '/api/presence')?.body).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Behaviour that is deliberately NOT supported
// ─────────────────────────────────────────────────────────────────────────────

describe('polling transport — unsupported events', () => {
  it('drops typing events without throwing or calling the API', async () => {
    const h = createHarness();
    const typing = collect(h.socket, ServerToClient.TYPING_UPDATE);

    h.socket.emit(ClientToServer.CONVERSATION_JOIN, { conversationId: 'c1' });
    h.socket.connect();
    await h.settle();
    h.calls.length = 0;

    expect(() => {
      h.socket.emit(ClientToServer.TYPING_START, { conversationId: 'c1' });
      h.socket.emit(ClientToServer.TYPING_STOP, { conversationId: 'c1' });
    }).not.toThrow();
    await h.settle();

    expect(h.calls).toHaveLength(0);
    expect(typing).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('polling transport — lifecycle', () => {
  it('polls nothing while the tab is hidden', async () => {
    const store = createStore();
    const calls: Call[] = [];
    const socket = createPollingSocket({
      rest: createRest(store, calls),
      isHidden: () => true,
      setTimer: () => 1,
      clearTimer: () => undefined,
    });

    socket.connect();
    await settle();

    // No reads at all. The one POST is the connect-time presence publish,
    // which is deliberate: a background tab is still a live session, and the
    // Socket.io path marks its user online on connect regardless of focus.
    expect(pathsOf(calls, 'GET')).toHaveLength(0);
    expect(pathsOf(calls, 'POST')).toEqual(['/api/presence']);
  });

  it('stops polling once disconnected', async () => {
    const h = createHarness();
    h.socket.connect();
    await h.settle();
    expect(h.calls.length).toBeGreaterThan(0);

    h.socket.disconnect();
    h.calls.length = 0;
    await h.tick();

    expect(h.calls).toHaveLength(0);
  });

  it('reports itself as the polling transport and as connected', async () => {
    const h = createHarness();
    expect(h.socket.transport).toBe('polling');
    expect(h.socket.connected).toBe(false);
    h.socket.connect();
    expect(h.socket.connected).toBe(true);
    await h.settle();
  });

  it('does nothing at all until connect() is called', async () => {
    // This pins the contract that `SocketProvider` must call `connect()`.
    // `io()` auto-connects inside its own constructor; this transport does not.
    // A consumer that relied on the Socket.io behaviour would get a connection
    // that is created, reports itself live, and silently polls nothing —
    // exactly the bug a browser check caught on the deployed site.
    const h = createHarness();

    h.socket.emit(ClientToServer.CONVERSATION_JOIN, { conversationId: 'c1' });
    await h.tick();
    await h.tick();

    expect(h.calls).toHaveLength(0);
    expect(h.socket.connected).toBe(false);

    // And once started, it works.
    h.socket.connect();
    await h.settle();
    expect(h.calls.length).toBeGreaterThan(0);
  });

  it('honours NEXT_PUBLIC_REALTIME_POLL_MS, and refuses a nonsensical value', () => {
    const previous = process.env.NEXT_PUBLIC_REALTIME_POLL_MS;
    const intervals: number[] = [];
    const build = () => {
      const socket = createRealtimeSocket({
        preference: 'poll',
        polling: {
          rest: createRest(createStore(), []),
          isHidden: () => true,
          setTimer: (_fn: () => void, ms: number) => {
            intervals.push(ms);
            return 1;
          },
          clearTimer: () => undefined,
        },
      });
      socket.connect();
    };

    try {
      process.env.NEXT_PUBLIC_REALTIME_POLL_MS = '7000';
      build();
      expect(intervals).toContain(7000);

      // `0` would otherwise become a request loop.
      intervals.length = 0;
      process.env.NEXT_PUBLIC_REALTIME_POLL_MS = '0';
      build();
      expect(intervals).toContain(3000);
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_REALTIME_POLL_MS;
      else process.env.NEXT_PUBLIC_REALTIME_POLL_MS = previous;
    }
  });

  it('a listener that throws does not stop the others', async () => {
    const h = createHarness();
    const healthy = collect(h.socket, ServerToClient.MESSAGE_NEW);
    h.socket.on(ServerToClient.MESSAGE_NEW, () => {
      throw new Error('broken consumer');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    h.socket.emit(ClientToServer.CONVERSATION_JOIN, { conversationId: 'c1' });
    h.socket.connect();
    await h.settle();
    h.store.messages.set('c1', [msg('m1')]);
    await h.tick();

    expect(healthy).toHaveLength(1);
    errorSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The Socket.io → polling fallback in transport.ts
// ─────────────────────────────────────────────────────────────────────────────

const { ioMock, fakeSocket } = vi.hoisted(() => {
  const bus = new Map<string, Set<(...args: unknown[]) => void>>();
  const fake = {
    connected: false,
    on(event: string, listener: (...args: unknown[]) => void) {
      let set = bus.get(event);
      if (!set) {
        set = new Set();
        bus.set(event, set);
      }
      set.add(listener);
      return fake;
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      bus.get(event)?.delete(listener);
      return fake;
    },
    emit() {
      return true;
    },
    connect() {
      fake.connected = true;
    },
    disconnect() {
      fake.connected = false;
    },
    removeAllListeners() {
      bus.clear();
    },
    fire(event: string, ...args: unknown[]) {
      for (const listener of [...(bus.get(event) ?? [])]) listener(...args);
    },
    listenerCount(event: string) {
      return bus.get(event)?.size ?? 0;
    },
  };
  return { ioMock: vi.fn(() => fake), fakeSocket: fake };
});

vi.mock('socket.io-client', () => ({ io: ioMock }));

describe('socket.io → polling fallback', () => {
  it('tolerates one failure, then switches transports in place', () => {
    const store = createStore();
    const calls: Call[] = [];
    const tasks = new Map<number, () => void>();
    let nextTimerId = 1;

    const socket = createRealtimeSocket({
      preference: 'auto',
      polling: {
        rest: createRest(store, calls),
        isHidden: () => false,
        setTimer: (fn: () => void) => {
          const id = nextTimerId;
          nextTimerId += 1;
          tasks.set(id, fn);
          return id;
        },
        clearTimer: (handle: unknown) => {
          tasks.delete(handle as number);
        },
      },
    });

    expect(socket.transport).toBe('socket.io');

    // A listener registered before the switch must survive it — that is the
    // whole point of the proxy, and what keeps `useConversation` working.
    const connects = collect(socket, 'connect');

    fakeSocket.fire('connect_error');
    expect(socket.transport).toBe('socket.io');

    fakeSocket.fire('connect_error');
    expect(socket.transport).toBe('polling');
    // The new transport's `connect` drives the provider's room re-subscription.
    expect(connects.length).toBeGreaterThan(0);

    socket.disconnect();
  });

  it('never falls back when the transport is forced to socket', () => {
    const socket = createRealtimeSocket({ preference: 'socket' });
    fakeSocket.fire('connect_error');
    fakeSocket.fire('connect_error');
    fakeSocket.fire('connect_error');
    expect(socket.transport).toBe('socket.io');
  });

  it('never opens a socket when the transport is forced to poll', () => {
    ioMock.mockClear();
    const socket = createRealtimeSocket({
      preference: 'poll',
      polling: {
        rest: createRest(createStore(), []),
        isHidden: () => true,
        setTimer: () => 1,
        clearTimer: () => undefined,
      },
    });
    expect(socket.transport).toBe('polling');
    expect(ioMock).not.toHaveBeenCalled();
  });
});
