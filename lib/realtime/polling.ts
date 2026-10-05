/**
 * lib/realtime/polling.ts — a REST-polling implementation of the realtime
 * transport contract (`lib/realtime/contract.ts`).
 *
 * WHY THIS EXISTS
 * `lib/realtime/server.ts` is Socket.io attached to `server.ts`, the custom
 * HTTP server. Vercel runs Next route handlers as serverless functions and
 * never executes `server.ts`, so on a Vercel deployment `/socket.io` does not
 * exist and the browser socket can never connect. Measured, same request:
 *
 *   local   GET /socket.io/?EIO=4&transport=polling
 *           → 200  `0{"sid":"YiI7CPxsMvd_qMzMAAAA","upgrades":["websocket"],…}`
 *   Vercel  GET /socket.io/?EIO=4&transport=polling
 *           → 308  `Redirecting...`   (the HTML app, not a handshake)
 *
 * Without a stand-in, the deployed app has NO live updates at all — and worse,
 * `useConversation().sendMessage` transmits over the socket, so sending a
 * message would silently fail too. This module implements the same six-member
 * contract on top of the REST API that already exists and is already tested.
 *
 * WHAT IT PRESERVES
 *   messages   `GET /api/conversations/:id/messages` newest page, diffed
 *              against a per-conversation snapshot → `message:new`,
 *              `message:updated`, `message:deleted`. The first poll after a
 *              join announces the whole page it sees, not just later
 *              additions — see `pollMessages` for the race that makes a
 *              silent baseline pass lose messages outright.
 *   sending    `emit('message:send', …)` → `POST /api/conversations/:id/
 *              messages` with the same `clientId` idempotency key the socket
 *              path uses, ack'd with the same `{ ok, message }` shape
 *   receipts   members' `lastReadAt` advances → `message:read`
 *   badges     `GET /api/conversations` `unreadCount` changes →
 *              `conversation:updated` (the payload AppShell already consumes)
 *   alerts     `GET /api/notifications` unseen ids → `notification:new`
 *   presence   `emit('presence:update')` → `POST /api/presence`, plus a
 *              heartbeat, so other clients see this user online
 *
 * WHAT IT DOES NOT PRESERVE
 *   - Typing indicators. They are pure ephemeral fan-out with no persisted
 *     state, so a poller has nothing to read. `emit('typing:*')` is dropped
 *     and `useTyping` returns an empty list. Every other part of chat works.
 *   - `message:delivered` — an ephemeral broadcast upstream too (see
 *     lib/realtime/README.md), never persisted.
 *   - Call signalling — that feature is being removed.
 *   - Sub-second latency: updates land within one poll interval (default 3 s).
 *
 * DESIGN NOTES
 *   - Framework-free: no React, no DOM required. `rest`, `isHidden`,
 *     `setTimer` and `clearTimer` are injectable so the whole thing is
 *     unit-testable in plain Node, which is where most of its risk lives.
 *   - One timer only. The poll interval drives everything; the presence
 *     heartbeat rides along every Nth tick rather than owning a second timer.
 *   - Every poll is wrapped: a transient failure must never kill the loop, so
 *     a rejected request is logged and the next tick tries again.
 *   - Nothing heavy polls while the tab is hidden; coming back triggers an
 *     immediate catch-up tick. Notifications are the exception and keep
 *     polling at a reduced cadence — see HIDDEN_NOTIFICATION_EVERY_N_TICKS.
 */

import { ClientToServer, ServerToClient } from './events';
import type {
  RealtimeAck,
  RealtimeListener,
  RealtimeSocket,
} from './contract';

// ─────────────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_POLL_MS = 3_000;
const MESSAGE_LIMIT = 50;
const NOTIFICATION_LIMIT = 20;
const CONVERSATION_LIMIT = 50;
/** The conversation list is the heaviest payload — poll it every Nth tick. */
const LIST_EVERY_N_TICKS = 2;
/** Read receipts come from the heaviest endpoint; see `pollReceipts`. */
const RECEIPTS_EVERY_N_TICKS = 2;
/** Presence heartbeat, in ticks (10 × 3 s = 30 s, matching the socket beat). */
const PRESENCE_EVERY_N_TICKS = 10;
/**
 * While the tab is hidden, only notifications are polled, and only this often.
 *
 * Notifications are the ONE signal whose entire purpose is to reach somebody
 * who is looking at something else — a hidden tab that reads nothing has no
 * desktop notification at all (`lib/desktop-notifications.ts` is fed from this
 * very poll). Everything else — the conversation list, message pages, read
 * receipts, the presence heartbeat — stays paused, because none of it is
 * useful to a tab nobody is watching.
 *
 * 4 × 3 s = 12 s. Browsers throttle timers in hidden tabs far more
 * aggressively than this (Chrome clamps to roughly one tick per minute after
 * five minutes), so the real cadence in the background is worse than the
 * number here; this is the floor we ask for, not a promise.
 */
const HIDDEN_NOTIFICATION_EVERY_N_TICKS = 4;
const DEFAULT_PRESENCE_STATUS = 'ONLINE';

// ─────────────────────────────────────────────────────────────────────────────
// Injectable REST access
// ─────────────────────────────────────────────────────────────────────────────

export interface PollingRest {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}

/**
 * Default REST access goes through `lib/api-client`, which attaches the CSRF
 * header and the session cookie. Imported lazily inside the factory so that
 * importing this module (in tests, or on the server) never pulls in the client
 * bundle's cookie handling.
 */
function defaultRest(): PollingRest {
  return {
    get: async <T,>(path: string): Promise<T> => {
      const { apiGet } = await import('@/lib/api-client');
      return apiGet<T>(path);
    },
    post: async <T,>(path: string, body?: unknown): Promise<T> => {
      const { apiPost } = await import('@/lib/api-client');
      return apiPost<T>(path, body);
    },
  };
}

export interface PollingTransportOptions {
  /** Poll interval in ms. Default 3000. */
  pollMs?: number;
  /** Injectable REST accessor (tests). */
  rest?: PollingRest;
  /** Injectable visibility check (tests). Defaults to the real document. */
  isHidden?: () => boolean;
  /** Injectable timer registration (tests). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// REST response shapes (only the fields this module reads)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A message as `GET /api/conversations/:id/messages` returns it.
 *
 * Note `conversationId` may be an EMPTY STRING: `messageTombstone()` in
 * `lib/services/serialize.ts` builds deleted messages with
 * `conversationId: ""`, and `useConversation` drops any `message:new` whose
 * `conversationId` does not match the open thread. Every view is therefore
 * re-stamped with the real id before it is emitted — see `pollConversation`.
 */
interface RestMessageView {
  id: string;
  conversationId?: string;
  body?: string | null;
  type?: string;
  createdAt?: string;
  editedAt?: string | null;
  deleted?: boolean;
  [key: string]: unknown;
}

interface MessagePage {
  data?: RestMessageView[];
  nextCursor?: string | null;
}

interface ConversationListItem {
  id: string;
  unreadCount?: number;
  /** ISO timestamp of the newest message — the row's preview keys off this. */
  lastMessageAt?: string;
  /** The newest message itself; only its id is read. */
  lastMessage?: { id?: string } | null;
}

interface ConversationDetail {
  id: string;
  members?: { user?: { id?: string }; lastReadAt?: string }[];
}

interface NotificationListPage {
  data?: { id: string }[];
  unreadCount?: number;
}

/** What we remember about a message between polls. */
interface MessageFingerprint {
  body: string | null;
  editedAt: string | null;
  deleted: boolean;
}

interface ConversationTrack {
  messages: Map<string, MessageFingerprint>;
  /** userId → lastReadAt, as of the previous poll. */
  readAt: Map<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function readString(source: unknown, key: string): string | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function fingerprint(view: RestMessageView): MessageFingerprint {
  return {
    body: typeof view.body === 'string' ? view.body : null,
    editedAt: typeof view.editedAt === 'string' ? view.editedAt : null,
    deleted: view.deleted === true,
  };
}

function sameFingerprint(a: MessageFingerprint, b: MessageFingerprint): boolean {
  return a.body === b.body && a.editedAt === b.editedAt && a.deleted === b.deleted;
}

/** Map a thrown API error onto a realtime error code for the ack. */
function failureCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && code.length > 0) return code;
  const status = (error as { status?: unknown })?.status;
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 400 || status === 422) return 'VALIDATION_ERROR';
  return 'INTERNAL';
}

// ─────────────────────────────────────────────────────────────────────────────
// The transport
// ─────────────────────────────────────────────────────────────────────────────

export function createPollingSocket(
  options: PollingTransportOptions = {},
): RealtimeSocket {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const rest = options.rest ?? defaultRest();
  const isHidden =
    options.isHidden ??
    (() =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const setTimer =
    options.setTimer ??
    ((fn: () => void, ms: number): unknown => setInterval(fn, ms));
  const clearTimer =
    options.clearTimer ??
    ((handle: unknown): void => {
      clearInterval(handle as ReturnType<typeof setInterval>);
    });

  const listeners = new Map<string, Set<RealtimeListener>>();
  const conversations = new Map<string, ConversationTrack>();

  let connected = false;
  let pollTimer: unknown = null;
  let inFlight = false;
  /** Counts down to the next conversation-list poll. */
  let listCountdown = 0;
  /** Counts down to the next read-receipt poll. */
  let receiptCountdown = 0;
  /** Counts down to the next presence heartbeat. */
  let presenceCountdown = PRESENCE_EVERY_N_TICKS;
  /** Counts down to the next notification-only poll of a hidden tab. */
  let hiddenTickCountdown = 0;
  /** Last presence payload the client asked us to publish. */
  let lastPresence: { status?: string } | null = null;
  /** Notification ids already announced. `null` until the first poll seeds it. */
  let seenNotifications: Set<string> | null = null;
  /**
   * conversationId → the list row, from the previous list poll.
   *
   * `null` means "not polled yet", which is NOT the same as an empty map. An
   * account in no conversations has an empty list, and inferring "first pass"
   * from emptiness re-armed the seed on every poll — so a conversation that
   * appeared later was never compared against anything.
   */
  let listSnapshot: Map<string, ConversationListItem> | null = null;

  // ── Listener registry ───────────────────────────────────────────────────

  function fire(event: string, ...args: unknown[]): void {
    const set = listeners.get(event);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      try {
        listener(...args);
      } catch (error) {
        // A broken consumer must not stop the other listeners, nor the poll.
        console.error('[realtime:polling] listener threw', event, error);
      }
    }
  }

  const on = (event: string, listener: RealtimeListener): void => {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(listener);
  };

  const off = (event: string, listener: RealtimeListener): void => {
    listeners.get(event)?.delete(listener);
  };

  // ── Polling ─────────────────────────────────────────────────────────────

  async function pollNotifications(): Promise<void> {
    const page = await rest.get<NotificationListPage>(
      `/api/notifications?limit=${NOTIFICATION_LIMIT}`,
    );
    const items = Array.isArray(page?.data) ? page.data : [];

    // First successful poll establishes the baseline. Without this the user
    // would get a burst of "new notification" events for their whole inbox.
    if (seenNotifications === null) {
      seenNotifications = new Set(items.map((n) => n.id));
      return;
    }

    // The API is newest-first; announce oldest-first so the consumer's
    // prepend leaves the newest notification on top.
    for (const item of [...items].reverse()) {
      if (!item?.id || seenNotifications.has(item.id)) continue;
      seenNotifications.add(item.id);
      fire(ServerToClient.NOTIFICATION_NEW, item);
    }
  }

  /**
   * The conversation list is the only REST view carrying each row's tail
   * (`lastMessage`/`lastMessageAt`), and `ConversationList` refreshes itself
   * on `conversation:updated`. So the diff has to watch the tail as well as
   * the unread count: the socket server emits on EVERY message, and a message
   * that does not move the unread count — your own, sent from another tab, or
   * one you read as it arrived — would otherwise leave the row's preview
   * showing the previous message indefinitely.
   */
  async function pollConversationList(): Promise<void> {
    const res = await rest.get<
      ConversationListItem[] | { data?: ConversationListItem[] }
    >(`/api/conversations?limit=${CONVERSATION_LIMIT}`);
    const list = Array.isArray(res) ? res : (res?.data ?? []);

    const next = new Map<string, ConversationListItem>();
    for (const item of list) {
      if (item?.id) next.set(item.id, item);
    }

    const previous = listSnapshot;
    listSnapshot = next;
    // First pass: record only — there is genuinely nothing to compare against.
    if (previous === null) return;

    for (const [conversationId, item] of next) {
      const before = previous.get(conversationId);
      // A conversation absent from the previous snapshot still has to be
      // announced. Its row may already carry a tail the list has never seen:
      // the list is polled only every other tick, so the poller's FIRST
      // sighting of a conversation routinely lands after the first message in
      // it (open a thread, send, and the next list poll is 6 s away).
      // Skipping those rows left the preview frozen on "No messages yet"
      // forever — reproduced against the live API with the real 6 s cadence:
      // zero events, row never refreshed.
      const unreadChanged = (before?.unreadCount ?? 0) !== (item.unreadCount ?? 0);
      const tailChanged = before?.lastMessageAt !== item.lastMessageAt;
      if (!unreadChanged && !tailChanged) continue;

      // Same payload shape the socket server sends, so AppShell (which reads
      // `unreadCount`) and ConversationList (which refreshes wholesale) both
      // behave identically on either transport.
      fire(ServerToClient.CONVERSATION_UPDATED, {
        conversationId,
        lastMessageAt: item.lastMessageAt,
        messageId: item.lastMessage?.id,
        unreadCount: item.unreadCount,
      });
    }
    // A conversation that disappeared (removed from, or deleted) is not
    // announced — AppShell's badge map is cleared on navigation anyway.
  }

  /**
   * Diff the newest page against the per-conversation snapshot.
   *
   * There is deliberately NO silent first pass. A baseline pass would have to
   * swallow whatever it found, and the first pass runs up to one interval
   * AFTER the thread mounted — while `ChatWindow` fetched its history at
   * mount. A message created in that gap is in neither: the page's history
   * read predates it, and the transport's baseline records it without
   * announcing it. It was then permanently invisible, because every later
   * poll saw it unchanged and stayed silent. Measured on the deployment: a
   * message posted 2.5 s after a thread opened never appeared, with the
   * poller fetching `/messages` four more times in the next 15 s and
   * answering 200 every time.
   *
   * So the first pass announces the page it sees, like any other pass. That
   * is safe because the only consumer, `useConversation` → `ChatWindow`,
   * merges `history` and `live` by message id and sorts by `createdAt`
   * (`ChatWindow.tsx`, "Merge history + live"), so re-announcing a message
   * the REST history already loaded is a no-op rather than a duplicate.
   * Erring towards announcing costs a redundant event; erring towards
   * swallowing costs the message.
   */
  async function pollMessages(conversationId: string): Promise<void> {
    const track = conversations.get(conversationId);
    if (!track) return;

    const page = await rest.get<MessagePage>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=${MESSAGE_LIMIT}`,
    );
    const items = Array.isArray(page?.data) ? page.data : [];

    const arrived: RestMessageView[] = [];
    for (const view of items) {
      if (!view?.id) continue;
      const next = fingerprint(view);
      const previous = track.messages.get(view.id);
      track.messages.set(view.id, next);

      if (!previous) {
        arrived.push(view);
      } else if (sameFingerprint(previous, next)) {
        continue;
      } else if (!previous.deleted && next.deleted) {
        fire(ServerToClient.MESSAGE_DELETED, { messageId: view.id });
      } else if (previous.editedAt !== next.editedAt) {
        fire(ServerToClient.MESSAGE_UPDATED, {
          messageId: view.id,
          body: next.body ?? undefined,
          editedAt: next.editedAt ?? undefined,
        });
      }
    }

    // `data` is newest-first and the UI appends, so emit oldest-first.
    // Re-stamp `conversationId`: a tombstone carries an empty one, and
    // `useConversation` drops any message whose conversationId does not match.
    for (const view of arrived.reverse()) {
      fire(ServerToClient.MESSAGE_NEW, {
        message: { ...view, conversationId },
      });
    }
  }

  /**
   * Read receipts. `GET /api/conversations/:id` is the only REST view that
   * exposes each member's `lastReadAt`, and it is the heaviest call in the
   * loop — it joins members and their users. It is also the least
   * latency-sensitive signal here, so it rides every Nth tick instead of every
   * one, halving the request count on an open thread.
   */
  async function pollReceipts(conversationId: string): Promise<void> {
    const track = conversations.get(conversationId);
    if (!track) return;

    const detail = await rest.get<ConversationDetail>(
      `/api/conversations/${encodeURIComponent(conversationId)}`,
    );
    for (const member of detail?.members ?? []) {
      const userId = member?.user?.id;
      const lastReadAt = member?.lastReadAt;
      if (!userId || !lastReadAt) continue;

      const before = track.readAt.get(userId);
      track.readAt.set(userId, lastReadAt);
      // First sighting is a baseline, not an advance.
      if (before === undefined || before === lastReadAt) continue;
      // Guard against a stale response arriving after a fresher one.
      if (new Date(lastReadAt).getTime() <= new Date(before).getTime()) continue;

      fire(ServerToClient.MESSAGE_READ, { conversationId, userId, lastReadAt });
    }
  }

  async function runTick(): Promise<void> {
    // `inFlight` keeps a slow tick from overlapping the next one.
    if (!connected || inFlight) return;

    // A hidden tab used to poll NOTHING, which meant it also received no
    // notifications — and a background tab is precisely when a desktop
    // notification matters. So the hidden path still runs, but only the
    // notification read, and only every Nth tick.
    const hidden = isHidden();
    if (hidden) {
      // Counted down BEFORE the test, so the first tick after connect polls
      // immediately (countdown 0 → -1 → refill) and the next one is
      // HIDDEN_NOTIFICATION_EVERY_N_TICKS ticks later, rather than one later.
      hiddenTickCountdown -= 1;
      if (hiddenTickCountdown > 0) return;
      hiddenTickCountdown = HIDDEN_NOTIFICATION_EVERY_N_TICKS;
    }

    inFlight = true;

    try {
      const jobs: Promise<void>[] = [pollNotifications()];

      if (!hidden) {
        if (listCountdown <= 0) {
          listCountdown = LIST_EVERY_N_TICKS;
          jobs.push(pollConversationList());
        }
        listCountdown -= 1;

        const withReceipts = receiptCountdown <= 0;
        if (withReceipts) receiptCountdown = RECEIPTS_EVERY_N_TICKS;
        receiptCountdown -= 1;

        for (const conversationId of [...conversations.keys()]) {
          jobs.push(pollMessages(conversationId));
          if (withReceipts) jobs.push(pollReceipts(conversationId));
        }

        presenceCountdown -= 1;
        if (presenceCountdown <= 0) {
          presenceCountdown = PRESENCE_EVERY_N_TICKS;
          jobs.push(publishPresence(lastPresence ?? {}));
        }
      }

      // `allSettled`, not `all`: one failing endpoint must not discard the
      // results of the others, and must not kill the loop.
      const results = await Promise.allSettled(jobs);
      for (const result of results) {
        if (result.status === 'rejected') {
          console.error('[realtime:polling] poll failed', result.reason);
        }
      }
    } finally {
      inFlight = false;
    }
  }

  // ── Client → server ─────────────────────────────────────────────────────

  async function sendMessage(
    payload: unknown,
    ack?: RealtimeAck,
  ): Promise<void> {
    const conversationId = readString(payload, 'conversationId');
    if (!conversationId) {
      ack?.({ ok: false, code: 'VALIDATION_ERROR' });
      return;
    }

    const input = (payload ?? {}) as Record<string, unknown>;
    try {
      const res = await rest.post<{ message?: RestMessageView }>(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          body: typeof input.body === 'string' ? input.body : undefined,
          type: typeof input.type === 'string' ? input.type : undefined,
          // Same idempotency key the socket path sends, so a retry after a
          // dropped response returns the original message instead of a dupe.
          clientId: typeof input.clientId === 'string' ? input.clientId : undefined,
          replyToId: readString(input, 'replyToId'),
          forwardedFromId: readString(input, 'forwardedFromId'),
          attachments: Array.isArray(input.attachments)
            ? input.attachments
            : undefined,
        },
      );

      const message = res?.message;
      if (!message?.id) {
        ack?.({ ok: false, code: 'INTERNAL' });
        return;
      }

      // Record it so the next poll does not re-announce our own message.
      const track = conversations.get(conversationId);
      if (track) track.messages.set(message.id, fingerprint(message));

      ack?.({
        ok: true,
        message: { ...message, conversationId },
      });
    } catch (error) {
      ack?.({
        ok: false,
        code: failureCode(error),
        message: error instanceof Error ? error.message : 'send failed',
      });
    }
  }

  async function markRead(payload: unknown): Promise<void> {
    const conversationId = readString(payload, 'conversationId');
    if (!conversationId) return;
    const messageId = readString(payload, 'messageId');
    try {
      await rest.post(
        `/api/conversations/${encodeURIComponent(conversationId)}/read`,
        messageId ? { messageId } : {},
      );
    } catch (error) {
      console.error('[realtime:polling] mark read failed', error);
    }
  }

  async function publishPresence(payload: { status?: string }): Promise<void> {
    try {
      await rest.post('/api/presence', payload.status ? { status: payload.status } : {});
    } catch (error) {
      // Presence is decoration; never surface a failure for it.
      console.error('[realtime:polling] presence publish failed', error);
    }
  }

  const emit = (
    event: string,
    payload?: unknown,
    ack?: RealtimeAck,
  ): void => {
    switch (event) {
      case ClientToServer.CONVERSATION_JOIN: {
        const conversationId = readString(payload, 'conversationId');
        if (conversationId && !conversations.has(conversationId)) {
          conversations.set(conversationId, {
            messages: new Map(),
            readAt: new Map(),
          });
        }
        return;
      }

      case ClientToServer.CONVERSATION_LEAVE: {
        const conversationId = readString(payload, 'conversationId');
        if (conversationId) conversations.delete(conversationId);
        return;
      }

      case ClientToServer.MESSAGE_SEND:
        void sendMessage(payload, ack);
        return;

      case ClientToServer.MESSAGE_READ:
        void markRead(payload);
        return;

      case ClientToServer.PRESENCE_UPDATE: {
        const status = readString(payload, 'status');
        lastPresence = status ? { status } : {};
        void publishPresence(lastPresence);
        return;
      }

      // Typing, delivery receipts and call signalling have no REST
      // equivalent. Dropping them here is deliberate and documented in the
      // module header; the socket implementation handles them when present.
      default:
        return;
    }
  };

  // ── Lifecycle ───────────────────────────────────────────────────────────

  function handleVisibilityChange(): void {
    if (isHidden()) return;
    // Catch up immediately rather than waiting out the interval.
    void runTick();
  }

  function connect(): void {
    if (connected) return;
    connected = true;
    listCountdown = 0;
    receiptCountdown = 0;
    presenceCountdown = PRESENCE_EVERY_N_TICKS;
    hiddenTickCountdown = 0;
    seenNotifications = null;
    listSnapshot = null;

    // `connect` first: the provider re-subscribes its rooms on this event, and
    // those `conversation:join` emits are what register the threads we poll.
    // `emit` is synchronous, so the joins land before the first tick.
    fire('connect');

    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    // A socket marks its user online on connect; mirror that so other clients
    // see this user straight away instead of waiting a full heartbeat.
    if (!lastPresence) lastPresence = { status: DEFAULT_PRESENCE_STATUS };
    void publishPresence(lastPresence);

    pollTimer = setTimer(() => {
      void runTick();
    }, pollMs);
    void runTick();
  }

  function disconnect(): void {
    connected = false;
    if (pollTimer !== null) {
      clearTimer(pollTimer);
      pollTimer = null;
    }
    if (typeof document !== 'undefined' && document.removeEventListener) {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    fire('disconnect');
  }

  return {
    transport: 'polling',
    get connected(): boolean {
      return connected;
    },
    on,
    off,
    emit,
    connect,
    disconnect,
  };
}
