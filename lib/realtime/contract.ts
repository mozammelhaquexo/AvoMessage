/**
 * lib/realtime/contract.ts — the transport contract.
 *
 * `lib/realtime/client.tsx` only ever touches six members of a connection, so
 * anything implementing this interface can serve as "the realtime connection".
 * Two things do:
 *
 *   - Socket.io (`lib/realtime/server.ts`, served by `server.ts`) — full
 *     duplex, sub-second, typing indicators, call signalling.
 *   - A REST poller (`lib/realtime/polling.ts`) — for hosts that cannot run a
 *     long-lived Node process (Vercel), where `/socket.io` never answers.
 *
 * The contract lives in its own module rather than inside either
 * implementation so that neither has to import the other at runtime.
 * `lib/realtime/transport.ts` is the only place that knows both exist.
 */

export type RealtimeTransport = 'socket.io' | 'polling';

/**
 * Listener signature.
 *
 * `any[]` rather than `unknown[]` deliberately. Handlers across the app are
 * declared with concrete payload types (`(p: PresencePayload) => void`,
 * `(p: { message: MessagePayload }) => void`, …) and those are NOT assignable
 * to `(...args: unknown[]) => void` under strictFunctionTypes — the parameter
 * would be contravariant. `lib/realtime/client.tsx` already uses this
 * signature for the same reason; this is the one place the loose type is
 * worth its cost, because it is the seam that lets a poller stand in for a
 * socket without a single hook changing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RealtimeListener = (...args: any[]) => void;

/** Ack callback for request/response events (`message:send`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RealtimeAck = (...args: any[]) => void;

export interface RealtimeSocket {
  /** Which implementation is live. Read by `usePresence` to decide whether it
   *  needs to poll, since a poller has no push channel to keep it fresh. */
  readonly transport: RealtimeTransport;
  readonly connected: boolean;
  on(event: string, listener: RealtimeListener): void;
  off(event: string, listener: RealtimeListener): void;
  /**
   * Send a client→server event. `payload` and `ack` are intentionally
   * untyped: the payload shapes are owned by `lib/realtime/events.ts` and
   * validated server-side, and the two implementations accept the same set.
   */
  emit(event: string, payload?: unknown, ack?: RealtimeAck): void;
  connect(): void;
  disconnect(): void;
}
