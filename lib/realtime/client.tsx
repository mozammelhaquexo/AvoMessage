/**
 * lib/realtime/client.tsx — browser Socket.io client for AvoMessage.
 *
 * `SocketProvider` owns one shared connection (cookie-authenticated; no token
 * ever touches JS). Hooks consume it:
 *
 *   useSocket()         → { socket, status, joinRoom, leaveRoom }
 *   useRealtimeEvent()  → subscribe to any server→client event
 *   usePresence()       → live presence map for a set of user ids
 *   useTyping()         → typing indicators for a conversation
 *   useConversation()   → live messages, delivery/read state, send/markRead
 *   useNotifications()  → live notification list
 *   useFeedUpdates()    → new public World posts as they arrive
 *
 * Reconnect: socket.io-client reconnects with exponential backoff; on every
 * `connect` the provider re-emits joins for all registered rooms so
 * subscriptions survive reconnects. Rooms are reference-counted so multiple
 * hooks can share one room safely.
 *
 * Transport: the connection is created by `./transport.ts`, which returns
 * either a Socket.io socket or a REST poller (`./polling.ts`). Everything below
 * is written against the six-member contract in `./contract.ts`, so the same
 * hooks serve both. The one hook that must know the difference is `usePresence`
 * — a poller has no push channel, so it refreshes its own snapshot instead of
 * waiting for `presence:update` events that will never arrive.
 *
 * Auth: the session cookie is httpOnly and sent automatically
 * (`withCredentials`). There is no token in JS to leak.
 */
'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createRealtimeSocket } from './transport';
import type { RealtimeSocket } from './contract';
import {
  ClientToServer,
  ServerToClient,
  type PresencePayload,
  type TypingPayload,
  type MessagePayload,
  type MessageQuotePayload,
  type NotificationPayload,
  type FeedPostPayload,
} from './events';
import { apiGet } from '@/lib/api-client';

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

interface SocketContextValue {
  /**
   * The live connection. Either a Socket.io socket or the REST poller — see
   * `lib/realtime/transport.ts`. Consumers never need to know which; the only
   * place that does is `usePresence`, which must poll when there is no push
   * channel to keep its map fresh.
   */
  socket: RealtimeSocket | null;
  status: ConnectionStatus;
  lastError: string | null;
  joinRoom(room: string): void;
  leaveRoom(room: string): void;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  status: 'connecting',
  lastError: null,
  joinRoom: () => undefined,
  leaveRoom: () => undefined,
});

export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}

/** Join the server-side event name + payload for a `room:{id}` room string. */
function roomJoinEvent(room: string): { event: string; payload: object } | null {
  const sep = room.indexOf(':');
  if (sep === -1) return null;
  const kind = room.slice(0, sep);
  const id = room.slice(sep + 1);
  if (!id) return null;
  switch (kind) {
    case 'conversation':
      return { event: ClientToServer.CONVERSATION_JOIN, payload: { conversationId: id } };
    case 'company':
      return { event: ClientToServer.COMPANY_JOIN, payload: { companyId: id } };
    case 'call':
      return { event: ClientToServer.CALL_JOIN, payload: { callId: id } };
    // `user:{id}` rooms are joined server-side on connect — never requested.
    default:
      return null;
  }
}

function roomLeaveEvent(room: string): { event: string; payload: object } | null {
  const join = roomJoinEvent(room);
  if (!join) return null;
  return {
    event: join.event.replace(':join', ':leave'),
    payload: join.payload,
  };
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<RealtimeSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [lastError, setLastError] = useState<string | null>(null);
  const socketRef = useRef<RealtimeSocket | null>(null);
  /** room → subscriber count (reference-counted across hooks). */
  const roomsRef = useRef(new Map<string, number>());

  useEffect(() => {
    // `createRealtimeSocket` picks the transport: Socket.io when a realtime
    // server is reachable, REST polling when it is not. The choice matters
    // because Socket.io needs a long-lived Node process, which serverless
    // hosts (Vercel) do not provide — there, `/socket.io` answers with the
    // HTML app and the socket never connects, which used to leave the
    // deployment with no live updates at all. See ./transport.ts for the
    // selection rules and ./polling.ts for what the fallback preserves.
    const s = createRealtimeSocket();
    socketRef.current = s;
    setSocket(s);

    const resubscribe = () => {
      setStatus('connected');
      setLastError(null);
      // Re-join every registered room (server re-checks membership).
      for (const room of roomsRef.current.keys()) {
        const join = roomJoinEvent(room);
        if (join) s.emit(join.event, join.payload);
      }
    };
    const onDisconnect = () => setStatus('disconnected');
    const onConnectError = (err: Error) => {
      setStatus('error');
      setLastError(err?.message ?? 'connection failed');
    };

    s.on('connect', resubscribe);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onConnectError);
    // Surface server-side `error` events (e.g. { code: 'FORBIDDEN' }).
    s.on(ServerToClient.ERROR, (payload: { message?: string }) => {
      setLastError(payload?.message ?? 'realtime error');
    });

    // `io()` starts connecting inside its own constructor; the polling
    // transport does not, so start it here explicitly. Listeners are already
    // registered, which is what lets the `connect` event be observed and the
    // room re-subscription above run. Without this the poller never starts:
    // nothing on the deployed site would update until a conversation was
    // opened, and even then only that one thread would.
    s.connect();

    return () => {
      s.off('connect', resubscribe);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onConnectError);
      s.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, []);

  const joinRoom = useCallback((room: string) => {
    const counts = roomsRef.current;
    const next = (counts.get(room) ?? 0) + 1;
    counts.set(room, next);
    if (next === 1) {
      const s = socketRef.current;
      const join = roomJoinEvent(room);
      if (s && s.connected && join) s.emit(join.event, join.payload);
      else if (s && !s.connected) s.connect();
    }
  }, []);

  const leaveRoom = useCallback((room: string) => {
    const counts = roomsRef.current;
    const next = (counts.get(room) ?? 0) - 1;
    if (next <= 0) {
      counts.delete(room);
      const s = socketRef.current;
      const leave = roomLeaveEvent(room);
      if (s && s.connected && leave) s.emit(leave.event, leave.payload);
    } else {
      counts.set(room, next);
    }
  }, []);

  const value = useMemo(
    () => ({ socket, status, lastError, joinRoom, leaveRoom }),
    [socket, status, lastError, joinRoom, leaveRoom],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

/**
 * Subscribe to a server→client event. The handler ref is kept fresh so
 * subscriptions don't churn on every render.
 */
export function useRealtimeEvent(
  event: string,
  // A generic event bus: handlers are declared with concrete payload types
  // (e.g. `(p: FeedPostPayload) => void`), which are not assignable to
  // `(...args: unknown[]) => void` under strictFunctionTypes. `any[]` is the
  // only signature that accepts them all.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => void,
): void {
  const { socket } = useSocket();
  const handlerRef = useRef(handler);

  // Mirror the latest handler for the subscription below, which is registered
  // once per (socket, event). Declared before it so the ref is current by the
  // time the listener can fire. Writing a ref during render is a React
  // Compiler violation.
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!socket) return;
    const listener = (...args: unknown[]) => handlerRef.current(...args);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Presence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How often a polling client re-reads presence. Shorter than the server's
 * 30 s heartbeat so a status change is picked up promptly, long enough that
 * the request is noise. Only used when the transport is `polling`.
 */
const PRESENCE_REFRESH_MS = 15_000;

/** Live presence for the given user ids (seed initial state via REST). */
export function usePresence(userIds: string[]): Record<string, PresencePayload> {
  const { socket } = useSocket();
  const [map, setMap] = useState<Record<string, PresencePayload>>({});
  const idsKey = useMemo(() => [...userIds].sort().join(','), [userIds]);
  const transport = socket?.transport;

  // Seed an initial snapshot over REST. The socket only carries presence for
  // shared conversation/company rooms (broadcastPresence in ./server), so
  // without this a viewer sees nothing at all for users they share no room
  // with — most of the feed, profiles, and the admin lists.
  //
  // On the polling transport there is no push channel at all, so this effect
  // also owns the refresh loop. `force` is what separates the two cases: a
  // socket-era value must never be clobbered by a slower snapshot, whereas on
  // a poller the snapshot IS the only source of truth.
  useEffect(() => {
    if (!idsKey) return;
    let cancelled = false;

    const refresh = async (force: boolean): Promise<void> => {
      try {
        const res = await apiGet<{ items: PresencePayload[] }>(
          `/api/presence?ids=${encodeURIComponent(idsKey)}`,
        );
        if (cancelled) return;
        setMap((prev) => {
          const next = { ...prev };
          for (const item of res.items ?? []) {
            if (force || !next[item.userId]) next[item.userId] = item;
          }
          return next;
        });
      } catch {
        /* presence is decoration — a failed read just leaves the dot unknown */
      }
    };

    void refresh(false);

    if (transport !== 'polling') {
      return () => {
        cancelled = true;
      };
    }

    const timer = setInterval(() => void refresh(true), PRESENCE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [idsKey, transport]);

  useRealtimeEvent(ServerToClient.PRESENCE_UPDATE, (payload: PresencePayload) => {
    if (!payload || typeof payload.userId !== 'string') return;
    if (!idsKey.split(',').includes(payload.userId)) return;
    setMap((prev) => ({ ...prev, [payload.userId]: payload }));
  });

  return map;
}

/** Publish our own presence (also acts as a heartbeat). */
export function usePublishPresence(
  status: 'ONLINE' | 'AWAY' | 'DO_NOT_DISTURB' | null,
  heartbeatMs = 30_000,
): void {
  const { socket } = useSocket();
  useEffect(() => {
    if (!socket) return;
    const beat = () =>
      socket.emit(ClientToServer.PRESENCE_UPDATE, status ? { status } : {});
    beat();
    const timer = setInterval(beat, heartbeatMs);
    return () => clearInterval(timer);
  }, [socket, status, heartbeatMs]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Typing
// ─────────────────────────────────────────────────────────────────────────────

export function useTyping(conversationId: string) {
  const { socket } = useSocket();
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startTyping = useCallback(() => {
    socket?.emit(ClientToServer.TYPING_START, { conversationId });
    if (stopTimer.current) clearTimeout(stopTimer.current);
    // Client-side backstop; the server also auto-clears after 5s.
    stopTimer.current = setTimeout(() => {
      socket?.emit(ClientToServer.TYPING_STOP, { conversationId });
    }, 4_000);
  }, [socket, conversationId]);

  const stopTyping = useCallback(() => {
    if (stopTimer.current) {
      clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
    socket?.emit(ClientToServer.TYPING_STOP, { conversationId });
  }, [socket, conversationId]);

  useRealtimeEvent(ServerToClient.TYPING_UPDATE, (payload: TypingPayload) => {
    if (!payload || payload.conversationId !== conversationId) return;
    setTypingUserIds((prev) =>
      payload.isTyping
        ? prev.includes(payload.userId)
          ? prev
          : [...prev, payload.userId]
        : prev.filter((id) => id !== payload.userId),
    );
  });

  useEffect(
    () => () => {
      if (stopTimer.current) clearTimeout(stopTimer.current);
    },
    [],
  );

  return { typingUserIds, startTyping, stopTyping };
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation (live messages / delivery / read receipts)
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientMessage extends MessagePayload {
  /** Local-only flags. */
  pending?: boolean;
  failed?: boolean;
  deleted?: boolean;
}

interface SendResponse {
  ok: boolean;
  code?: string;
  message?: MessagePayload;
  deduped?: boolean;
}

export function useConversation(conversationId: string) {
  const { socket, joinRoom, leaveRoom } = useSocket();
  const [messages, setMessages] = useState<ClientMessage[]>([]);
  /** messageId → user ids that reported delivery. */
  const [deliveredBy, setDeliveredBy] = useState<Record<string, string[]>>({});
  /** userId → ISO lastReadAt. */
  const [readState, setReadState] = useState<Record<string, string>>({});
  const room = useMemo(() => `conversation:${conversationId}`, [conversationId]);

  // Join on mount / conversation change; leave on unmount.
  useEffect(() => {
    setMessages([]);
    setDeliveredBy({});
    setReadState({});
    joinRoom(room);
    return () => leaveRoom(room);
  }, [room, joinRoom, leaveRoom]);

  useRealtimeEvent(ServerToClient.MESSAGE_NEW, (payload: { message: MessagePayload }) => {
    const message = payload?.message;
    if (!message || message.conversationId !== conversationId) return;
    setMessages((prev) =>
      prev.some((m) => m.id === message.id) ? prev : [...prev, message],
    );
  });

  useRealtimeEvent(
    ServerToClient.MESSAGE_UPDATED,
    (payload: { messageId: string; body?: string; editedAt?: string }) => {
      if (!payload?.messageId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.messageId
            ? {
                ...m,
                body: payload.body ?? m.body,
                editedAt: payload.editedAt ?? m.editedAt,
              }
            : m,
        ),
      );
    },
  );

  useRealtimeEvent(
    ServerToClient.MESSAGE_DELETED,
    (payload: { messageId: string }) => {
      if (!payload?.messageId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.messageId
            ? { ...m, deleted: true, body: null, attachments: [] }
            : m,
        ),
      );
    },
  );

  useRealtimeEvent(
    ServerToClient.MESSAGE_DELIVERED,
    (payload: { messageId: string; userId: string }) => {
      if (!payload?.messageId || !payload?.userId) return;
      setDeliveredBy((prev) => {
        const users = prev[payload.messageId] ?? [];
        if (users.includes(payload.userId)) return prev;
        return { ...prev, [payload.messageId]: [...users, payload.userId] };
      });
    },
  );

  useRealtimeEvent(
    ServerToClient.MESSAGE_READ,
    (payload: { conversationId: string; userId: string; lastReadAt: string }) => {
      if (!payload || payload.conversationId !== conversationId) return;
      setReadState((prev) => ({ ...prev, [payload.userId]: payload.lastReadAt }));
    },
  );

  /**
   * Send a message over the socket. Attachments follow the socket
   * `attachmentInput` shape (no `id` — the server assigns ids on persist);
   * callers may still pass attachments that already have ids (e.g. retries).
   */
  const sendMessage = useCallback(
    (
      input: {
        body?: string;
        type?: string;
        replyToId?: string;
        /** Set when this send is a forward. The server verifies read access. */
        forwardedFromId?: string;
        /** Optimistic preview of the forward source, shown until the ack. */
        forwardedFrom?: MessageQuotePayload | null;
        attachments?: Array<{
          id?: string;
          kind: ClientMessage['attachments'][number]['kind'];
          url: string;
          name?: string | null;
          mimeType?: string | null;
          sizeBytes?: number | null;
          width?: number | null;
          height?: number | null;
        }>;
      },
    ): void => {
      if (!socket) return;
      const clientId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const optimistic: ClientMessage = {
        id: `pending:${clientId}`,
        conversationId,
        senderId: null,
        body: input.body ?? null,
        type: (input.type as ClientMessage['type']) ?? 'TEXT',
        replyToId: input.replyToId,
        forwardedFrom: input.forwardedFrom ?? undefined,
        createdAt: new Date().toISOString(),
        editedAt: null,
        author: null,
        // Optimistic attachments get local-only ids; the server assigns real
        // ids on persist (the socket attachmentInput schema takes no id).
        attachments: (input.attachments ?? []).map((a, i) => ({
          id: a.id ?? `local:${clientId}:${i}`,
          kind: a.kind,
          url: a.url,
          name: a.name ?? null,
          mimeType: a.mimeType ?? null,
          sizeBytes: a.sizeBytes ?? null,
          width: a.width ?? null,
          height: a.height ?? null,
        })),
        pending: true,
      };
      setMessages((prev) => [...prev, optimistic]);
      socket.emit(
        ClientToServer.MESSAGE_SEND,
        {
          conversationId,
          clientId,
          body: input.body,
          type: input.type ?? 'TEXT',
          replyToId: input.replyToId,
          forwardedFromId: input.forwardedFromId,
          attachments: input.attachments,
        },
        (res: SendResponse) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === optimistic.id
                ? res?.ok && res.message
                  ? { ...res.message }
                  : { ...m, pending: false, failed: true }
                : m,
            ),
          );
        },
      );
    },
    [socket, conversationId],
  );

  const retryMessage = useCallback(
    (pendingId: string) => {
      setMessages((prev) => {
        const target = prev.find((m) => m.id === pendingId);
        if (!target || !target.failed) return prev;
        const rest = prev.filter((m) => m.id !== pendingId);
        // Re-send as a new attempt (new clientId).
        queueMicrotask(() =>
          sendMessage({
            body: target.body ?? undefined,
            type: target.type,
            replyToId: target.replyToId,
            forwardedFromId: target.forwardedFrom?.id,
            forwardedFrom: target.forwardedFrom ?? null,
            attachments: target.attachments,
          }),
        );
        return rest;
      });
    },
    [sendMessage],
  );

  const markDelivered = useCallback(
    (messageId: string) => {
      socket?.emit(ClientToServer.MESSAGE_DELIVERED, { messageId });
    },
    [socket],
  );

  const markRead = useCallback(
    (messageId?: string) => {
      socket?.emit(ClientToServer.MESSAGE_READ, { conversationId, messageId });
    },
    [socket, conversationId],
  );

  return {
    messages,
    deliveredBy,
    readState,
    sendMessage,
    retryMessage,
    markDelivered,
    markRead,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The unread badge is shared module state, not per-hook state.
 *
 * `useNotifications()` is mounted more than once: AppShell owns the sidebar and
 * mobile-nav badge, while the notification centre owns the list. With private
 * `useState` per instance, marking everything read in the centre left the
 * sidebar showing the old number until a reload — the two instances never saw
 * each other's writes. One module-level value, read through
 * `useSyncExternalStore`, keeps every instance in step.
 *
 * SSR-safe: the server snapshot is the constant 0, which is also what the
 * hydration pass reads, so the badge cannot cause a hydration mismatch.
 */
let unreadCountValue = 0;
const unreadListeners = new Set<() => void>();

function emitUnreadChange(): void {
  for (const listener of unreadListeners) listener();
}

function subscribeUnread(listener: () => void): () => void {
  unreadListeners.add(listener);
  return () => {
    unreadListeners.delete(listener);
  };
}

/** Snapshots MUST be primitives — `useSyncExternalStore` compares with Object.is. */
function getUnreadSnapshot(): number {
  return unreadCountValue;
}

function getServerUnreadSnapshot(): number {
  return 0;
}

/**
 * Read-modify-write against module state with no await in between, so it is
 * atomic: two notifications arriving in the same tick can't clobber each other.
 */
function updateUnread(updater: (prev: number) => number): void {
  const next = Math.max(0, updater(unreadCountValue));
  if (next === unreadCountValue) return;
  unreadCountValue = next;
  emitUnreadChange();
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<NotificationPayload[]>([]);
  const unreadCount = useSyncExternalStore(
    subscribeUnread,
    getUnreadSnapshot,
    getServerUnreadSnapshot,
  );

  useRealtimeEvent(
    ServerToClient.NOTIFICATION_NEW,
    (payload: NotificationPayload) => {
      if (!payload || typeof payload.id !== 'string') return;
      setNotifications((prev) =>
        prev.some((n) => n.id === payload.id) ? prev : [payload, ...prev],
      );
      if (!payload.readAt) updateUnread((c) => c + 1);
    },
  );

  /**
   * Seed from the REST list endpoint. `unread` must be the server's own
   * `unreadCount` — not a recount of the loaded page, which is capped at one
   * page and would under-report.
   */
  const seed = useCallback(
    (items: NotificationPayload[], unread: number) => {
      setNotifications(items);
      updateUnread(() => unread);
    },
    [],
  );

  /** Optimistic local mark-all-read (pair with the REST call). */
  const markAllReadLocal = useCallback(() => {
    const now = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) => (n.readAt ? n : { ...n, readAt: now })),
    );
    updateUnread(() => 0);
  }, []);

  const markOneReadLocal = useCallback(
    (id: string) => {
      const target = notifications.find((n) => n.id === id);
      if (!target || target.readAt) return;
      updateUnread((c) => c - 1);
      const now = new Date().toISOString();
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: now } : n)),
      );
    },
    [notifications],
  );

  return { notifications, unreadCount, seed, markAllReadLocal, markOneReadLocal };
}

// ─────────────────────────────────────────────────────────────────────────────
// Feed updates (public World posts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calls `onPost` for every new public post broadcast. The consumer decides
 * whether to prepend (e.g. only when the user is at the top of the feed).
 */
export function useFeedUpdates(onPost: (post: FeedPostPayload) => void): void {
  const handlerRef = useRef(onPost);

  useEffect(() => {
    handlerRef.current = onPost;
  }, [onPost]);

  useRealtimeEvent(ServerToClient.FEED_POST_NEW, (payload: { post: FeedPostPayload }) => {
    const post = payload?.post;
    if (post && typeof post.id === 'string') handlerRef.current(post);
  });
}
