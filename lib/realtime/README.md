# Realtime layer (Socket.io)

Owner: Realtime Engineer. Layout follows `docs/ARCHITECTURE.md` §3.

## Files

| File | Role |
|---|---|
| `lib/realtime/events.ts` | Shared event catalog — room-name helpers, event-name constants, zod schemas for every client→server payload, TS types for server→client payloads. Imported by both sides: **no drift by construction**. |
| `lib/realtime/server.ts` | Socket.io server. `attachRealtime(httpServer, deps?)` / `getRealtime()`. Owns handshake auth, membership-checked joins, presence, typing, messages, notifications fan-out, feed fan-out, call signaling, rate limits, payload validation. |
| `lib/realtime/store.ts` | Lazy Prisma accessor (`getDb()`, fail-closed while `@prisma/client` is ungenerated) + `verifyHandshakeSession()` implementing the ARCHITECTURE.md §2.2 cookie protocol (`avo_session=<raw>.<sig>`, HMAC-SHA256, SHA-256 tokenHash lookup, revoked/expiry/active checks, debounced sliding refresh). Self-contained on purpose: `lib/auth/session.ts` is Next/`@/`-bound; keep the two in sync (cookie name, hash/HMAC schemes). |
| `lib/realtime/client.tsx` | Browser side: `SocketProvider`, `useSocket`, `useRealtimeEvent`, `usePresence`, `usePublishPresence`, `useTyping`, `useConversation` (optimistic send, clientId dedupe, delivery/read), `useNotifications`, `useFeedUpdates`. Cookie auth (`withCredentials`), exponential-backoff reconnect, reference-counted rooms, resubscribe on reconnect. |
| `server.ts` (root) | Custom HTTP server: Next.js + Socket.io on one port. |
| `tsconfig.server.json` | Compiled-production build → `dist-server/` (runnable with plain `node`). |
| `scripts/socket-smoke.mjs` | Smoke + integration test (see below). |

Layout choice: `lib/realtime/server.ts` (not `server/socket.ts`) — matches ARCHITECTURE.md.

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
