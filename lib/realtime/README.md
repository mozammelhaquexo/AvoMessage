# Realtime layer (Socket.io)

Owner: Realtime Engineer. Layout follows `docs/ARCHITECTURE.md` §3.

## Files

| File | Role |
|---|---|
| `lib/realtime/events.ts` | Shared event catalog — room-name helpers, event-name constants, zod schemas for every client→server payload, TS types for server→client payloads. Imported by both sides: **no drift by construction**. |
| `lib/realtime/contract.ts` | The six-member `RealtimeSocket` contract that both transports satisfy (`transport`, `connected`, `on`, `off`, `emit`, `connect`, `disconnect`). Exists so neither implementation imports the other at runtime. |
| `lib/realtime/server.ts` | Socket.io server. `attachRealtime(httpServer, deps?)` / `getRealtime()`. Owns handshake auth, membership-checked joins, presence, typing, messages, notifications fan-out, feed fan-out, call signaling, rate limits, payload validation. |
| `lib/realtime/store.ts` | Lazy Prisma accessor (`getDb()`, fail-closed while `@prisma/client` is ungenerated) + `verifyHandshakeSession()` implementing the ARCHITECTURE.md §2.2 cookie protocol (`avo_session=<raw>.<sig>`, HMAC-SHA256, SHA-256 tokenHash lookup, revoked/expiry/active checks, debounced sliding refresh). Self-contained on purpose: `lib/auth/session.ts` is Next/`@/`-bound; keep the two in sync (cookie name, hash/HMAC schemes). |
| `lib/realtime/client.tsx` | Browser side: `SocketProvider`, `useSocket`, `useRealtimeEvent`, `usePresence`, `usePublishPresence`, `useTyping`, `useConversation` (optimistic send, clientId dedupe, delivery/read), `useNotifications`, `useFeedUpdates`. Cookie auth (`withCredentials`), exponential-backoff reconnect, reference-counted rooms, resubscribe on reconnect. |
| `lib/realtime/transport.ts` | Picks the transport: `NEXT_PUBLIC_REALTIME_TRANSPORT` (`auto` \| `socket` \| `poll`) or, on `auto`, Socket.io with an in-place switch to polling after two failed connection attempts. Also reads `NEXT_PUBLIC_REALTIME_POLL_MS`. |
| `lib/realtime/polling.ts` | REST implementation of the contract, for hosts that cannot run a long-lived Node process. See below. |
| `server.ts` (root) | Custom HTTP server: Next.js + Socket.io on one port. |
| `tsconfig.server.json` | Compiled-production build → `dist-server/` (runnable with plain `node`). |
| `scripts/socket-smoke.mjs` | Smoke + integration test (see below). |

Layout choice: `lib/realtime/server.ts` (not `server/socket.ts`) — matches ARCHITECTURE.md.

## Which transport is live, and why it matters

Socket.io needs a long-lived Node process. Serverless hosts (Vercel) do not
provide one — they run Next route handlers as functions and never execute
`server.ts`. There, `/socket.io` is not a handshake at all. Same request, both
hosts:

```
local   GET /socket.io/?EIO=4&transport=polling
        → 200  `0{"sid":"YiI7CPxsMvd_qMzMAAAA","upgrades":["websocket"],…}`
Vercel  GET /socket.io/?EIO=4&transport=polling
        → 308  `Redirecting...`      (the HTML app)
```

Before `polling.ts` existed this was not a cosmetic gap: `useConversation`'s
`sendMessage` transmits over the socket, so on Vercel **sending a message failed
silently** — the optimistic bubble stayed pending forever. Live updates, read
receipts, unread badges and presence were all dead too.

`lib/realtime/polling.ts` re-implements the contract on top of the REST API, so
`client.tsx` and every hook above it are unchanged. What it carries:

| Preserved | How |
|---|---|
| New / edited / deleted messages | `GET /api/conversations/:id/messages` diffed against a snapshot |
| Sending (with `clientId` idempotency) | `POST /api/conversations/:id/messages` |
| Read receipts | members' `lastReadAt` from `GET /api/conversations/:id` |
| Unread badges | `unreadCount` from `GET /api/conversations` → `conversation:updated` |
| Notifications | new ids from `GET /api/notifications` |
| Presence | `POST /api/presence` (added for this) + a 30 s heartbeat |

Not preserved, by design:

- **Typing indicators** — pure ephemeral fan-out with nothing persisted to read.
  `useTyping` returns an empty list; its emits are dropped.
- **`message:delivered`** — ephemeral upstream too (never persisted).
- **Call signalling** — that feature is being removed.
- **Sub-second latency** — updates land within one poll interval (default 3 s).

Deployment: set `NEXT_PUBLIC_REALTIME_TRANSPORT=poll` on Vercel so the doomed
Socket.io attempt is skipped entirely. `auto` also works (it falls back after
two failed attempts), and is the right default for any host not yet measured.
Everything the transport does is covered by `tests/realtime-polling.test.ts`.

## Run

```bash
npm run dev            # tsx server.ts — Next + realtime, one port (default 3000)
npm run dev:next       # plain `next dev` — no realtime
npm start              # NODE_ENV=production tsx server.ts
npm run build:server   # tsc -p tsconfig.server.json → dist-server/
npm run start:compiled # NODE_ENV=production node dist-server/server.js (no tsx needed)
npm run realtime:smoke # build:server, then the smoke test below
```

Env: `PORT` (default 3000), `HOSTNAME` (default 0.0.0.0), `SESSION_SECRET`
(required — handshake auth fails closed without it), `SOCKET_IO_PATH`
(default `/socket.io`), `SOCKET_IO_CORS_ORIGIN` (default `http://localhost:3000`).

## Testing

`scripts/socket-smoke.mjs` runs against the **compiled** output (`dist-server/`),
on bare HTTP servers (isolates the realtime layer from app-route issues):

- **Phase A (no DB):** socket.io attached; no cookie → `connect_error`
  `unauthenticated`; garbage cookie → rejected; helper fan-outs are safe no-ops.
- **Phase B (in-memory fake DB, injected via `attachRealtime(server, { db })`):**
  session-cookie auth, membership-checked `conversation:join`, `FORBIDDEN` on
  non-member join, `typing:update` broadcast, idempotent `message:send`
  (clientId dedupe), `VALIDATION_ERROR` on bad payload, `message:read`
  broadcast, `presence:update` broadcast, full call lifecycle
  (ring → incoming → accept → offer relay → hangup → ended).

28 assertions, all passing (2026-10-02). The `{ db }` injection is also the
hook the messaging/calls agents can reuse in their own service tests.

## Security rules (enforced in code)

- Never trust client-supplied user ids — `socket.data.userId` comes only from
  the verified session cookie.
- Rooms are membership-checked on every join (`user:{id}` own-only,
  `conversation:`/`company:`/`call:` re-verified against the DB).
- Private data is only emitted to membership-checked rooms.
- Every client→server payload is zod-validated; failures get machine-readable
  `error` events (`VALIDATION_ERROR`, `FORBIDDEN`, `RATE_LIMITED`, …).
- Per-user rate limits on all mutating events via `checkRateLimit`.

## Known cross-team blockers (not realtime-owned)

- `npx tsc --noEmit` has errors, all in backend-owned files (ungenerated
  `@prisma/client` → `TS2305` in services/auth/permissions; implicit anys).
  Realtime files contribute zero.
- `next build` fails on missing exports in `@/lib/services/companies` and
  `@/lib/validation` (API team's route↔service mismatch) — none realtime.
- `tsx server.ts` cannot boot while `app/api/invitations/[id]` and
  `app/api/invitations/[token]` coexist (Next dynamic-route slug conflict,
  API-team owned). The realtime layer itself boots — proven by the smoke test.
- `replyToId` is accepted/validated/echoed but **not persisted** — the Prisma
  schema has no column yet (messaging/DB agent migration).
- `message:delivered` is an ephemeral broadcast; persistent per-recipient
  delivery state is deferred to the phase-6 `MessageDelivery` model.
- `lib/prisma-types.ts` (backend stopgap) was missing `UserPresence` +
  `PresenceStatus`; added (faithful to the schema).
