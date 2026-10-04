/**
 * lib/realtime/transport.ts — choose how the browser reaches realtime.
 *
 * Two transports implement `RealtimeSocket` (see ./contract.ts):
 *
 *   socket.io  full duplex; needs a long-lived Node process (`server.ts`)
 *   polling    REST; works anywhere, ~3 s latency, no typing indicators
 *
 * Selection, in order:
 *
 *   1. `NEXT_PUBLIC_REALTIME_TRANSPORT` — `poll` / `socket` forces one.
 *      Set `poll` on Vercel: it skips a connection attempt that is known to
 *      fail, so the first poll happens immediately instead of after a timeout.
 *   2. `auto` (the default) — start Socket.io, and if it cannot connect within
 *      a couple of attempts, switch to polling for the rest of the session.
 *
 * `auto` exists so the app degrades correctly on ANY host, including ones I
 * have not measured. The fallback is a proxy, not a restart: it keeps the
 * listener registry, re-attaches every listener to the new transport, and lets
 * the new transport's `connect` event drive the provider's room
 * re-subscription — so the rooms the dead socket had accepted are replayed
 * onto the poller and no consumer has to know a switch happened.
 */

'use client';

import { io, type Socket } from 'socket.io-client';
import type {
  RealtimeAck,
  RealtimeListener,
  RealtimeSocket,
} from './contract';
import { createPollingSocket, type PollingTransportOptions } from './polling';

export type TransportPreference = 'auto' | 'socket' | 'poll';

/**
 * How many failed Socket.io connection attempts before switching to polling.
 *
 * Two is deliberate: one failure can be a blip, but on a host with no
 * Socket.io endpoint every attempt fails identically, and the user is sitting
 * there with no live updates while we retry. Two attempts costs well under a
 * second on Vercel (the websocket upgrade and the polling request both fail
 * fast) and leaves no room for a lost send, because the switch lands long
 * before a human can open a conversation and type a message.
 */
const MAX_CONNECT_FAILURES = 2;

const DEFAULT_POLL_MS = 3_000;
/** Below this the poll becomes a load test; above it, "live" stops being true. */
const MIN_POLL_MS = 500;
const MAX_POLL_MS = 60_000;

/**
 * Poll interval, in order of precedence: an explicit option, then
 * `NEXT_PUBLIC_REALTIME_POLL_MS`, then 3 s. Clamped, because an unvalidated
 * env value of `0` would turn the poller into a request loop.
 */
function resolvePollMs(override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= MIN_POLL_MS) {
    return Math.min(override, MAX_POLL_MS);
  }
  const raw = Number.parseInt(process.env.NEXT_PUBLIC_REALTIME_POLL_MS ?? '', 10);
  if (Number.isFinite(raw) && raw >= MIN_POLL_MS) return Math.min(raw, MAX_POLL_MS);
  return DEFAULT_POLL_MS;
}

export function resolveTransportPreference(
  raw: string | undefined = process.env.NEXT_PUBLIC_REALTIME_TRANSPORT,
): TransportPreference {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'socket' || value === 'socket.io') return 'socket';
  if (value === 'poll' || value === 'polling') return 'poll';
  return 'auto';
}

/**
 * `NEXT_PUBLIC_SOCKET_URL` lets the realtime server live on a different host
 * from the Next app. Unset (the default) means same-origin, which is what the
 * custom server provides.
 */
export function realtimeUrl(): string | undefined {
  const url = (process.env.NEXT_PUBLIC_SOCKET_URL ?? '').trim();
  return url.length > 0 ? url : undefined;
}

/** Present a `socket.io-client` socket as a `RealtimeSocket`. */
function adaptSocketIo(socket: Socket): RealtimeSocket {
  return {
    transport: 'socket.io',
    get connected(): boolean {
      return socket.connected;
    },
    on: (event: string, listener: RealtimeListener) => {
      socket.on(event, listener);
    },
    off: (event: string, listener: RealtimeListener) => {
      socket.off(event, listener);
    },
    emit: (event: string, payload?: unknown, ack?: RealtimeAck) => {
      if (ack) socket.emit(event, payload, ack);
      else socket.emit(event, payload);
    },
    connect: () => {
      socket.connect();
    },
    disconnect: () => {
      socket.disconnect();
    },
  };
}

/**
 * Wrap a live Socket.io socket so it can be replaced by a poller in place.
 *
 * The wrapper owns the listener registry — the single source of truth — and
 * mirrors it onto whichever transport is current. That is what makes the swap
 * invisible: a consumer that registered `message:new` before the switch still
 * receives it after.
 */
function withPollingFallback(
  socket: Socket,
  options: CreateRealtimeSocketOptions,
): RealtimeSocket {
  const registry = new Map<string, Set<RealtimeListener>>();
  let delegate: RealtimeSocket = adaptSocketIo(socket);
  let switched = false;
  let failures = 0;

  const attachAll = (target: RealtimeSocket): void => {
    for (const [event, set] of registry) {
      for (const listener of set) target.on(event, listener);
    }
  };
  const detachAll = (target: RealtimeSocket): void => {
    for (const [event, set] of registry) {
      for (const listener of set) target.off(event, listener);
    }
  };

  const switchToPolling = (): void => {
    if (switched) return;
    switched = true;
    console.warn(
      '[realtime] Socket.io is unreachable on this host; falling back to REST ' +
        'polling. Live messages, receipts, notifications and presence continue ' +
        `at a ${options.polling?.pollMs ?? 3_000} ms interval. Typing ` +
        'indicators are unavailable without a socket server.',
    );

    detachAll(delegate);
    socket.removeAllListeners();
    socket.disconnect();

    delegate = createPollingSocket(options.polling);
    attachAll(delegate);
    // The polling transport fires `connect`, which is what makes the provider
    // replay its room joins onto the new transport.
    delegate.connect();
  };

  socket.on('connect', () => {
    failures = 0;
  });
  socket.on('connect_error', () => {
    failures += 1;
    if (failures >= MAX_CONNECT_FAILURES) switchToPolling();
  });

  return {
    get transport() {
      return delegate.transport;
    },
    get connected(): boolean {
      return delegate.connected;
    },
    on: (event: string, listener: RealtimeListener) => {
      let set = registry.get(event);
      if (!set) {
        set = new Set();
        registry.set(event, set);
      }
      set.add(listener);
      delegate.on(event, listener);
    },
    off: (event: string, listener: RealtimeListener) => {
      registry.get(event)?.delete(listener);
      delegate.off(event, listener);
    },
    emit: (event: string, payload?: unknown, ack?: RealtimeAck) => {
      delegate.emit(event, payload, ack);
    },
    connect: () => {
      delegate.connect();
    },
    disconnect: () => {
      socket.removeAllListeners();
      socket.disconnect();
      delegate.disconnect();
    },
  };
}

export interface CreateRealtimeSocketOptions {
  /** Override the env-driven preference (tests). */
  preference?: TransportPreference;
  /** Override `NEXT_PUBLIC_SOCKET_URL` (tests). */
  url?: string;
  /** Options handed to the polling transport when it is used. */
  polling?: PollingTransportOptions;
}

export function createRealtimeSocket(
  options: CreateRealtimeSocketOptions = {},
): RealtimeSocket {
  const preference = options.preference ?? resolveTransportPreference();
  const polling: PollingTransportOptions = {
    ...options.polling,
    pollMs: resolvePollMs(options.polling?.pollMs),
  };

  if (preference === 'poll') return createPollingSocket(polling);

  const socket = io(options.url ?? realtimeUrl(), {
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    // Shorter than the default 1 s: on a host without Socket.io the first
    // failure is immediate, and a long delay only postpones the fallback.
    reconnectionDelay: 500,
    reconnectionDelayMax: 30_000,
    randomizationFactor: 0.5,
    timeout: 20_000,
    transports: ['websocket', 'polling'],
  });

  if (preference === 'socket') return adaptSocketIo(socket);
  return withPollingFallback(socket, { ...options, polling });
}
