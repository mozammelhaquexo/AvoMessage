# AvoMessage 🥑

A production-grade **social messaging + company collaboration platform**: social
network, real-time messaging, company/team workspaces, voice messages, audio
calls, public "World" feed, admin & manager consoles, notifications, search,
and live presence — in one Next.js app.

## Architecture at a glance

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript (strict) + Tailwind CSS |
| Server | Custom `server.ts`: Next.js + Socket.io on **one HTTP port** |
| Database | PostgreSQL 16 + Prisma ORM |
| Auth | Email/password (bcrypt, cost 12), DB-backed sessions, signed httpOnly cookies, double-submit CSRF |
| Realtime | Socket.io — presence, typing, delivery/read receipts, live notifications, call signaling |
| Calls | WebRTC P2P with Socket.io signaling; STUN + TURN via env |
| Storage | Driver abstraction: local disk (dev) / S3-compatible (prod) |
| Mail | Driver abstraction: log (dev) / Resend / SMTP (prod) |
| Tests | Vitest — unit + DB-backed API/integration incl. authorization-matrix tests |

Key docs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
[`docs/RBAC.md`](docs/RBAC.md) · [`docs/ROUTES.md`](docs/ROUTES.md) ·
[`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md) ·
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (production runbook)

**Health check:** `GET /api/health` → `{ status, version, uptime, startedAt, db }`
(200 when the DB is reachable, 503 `degraded` otherwise; unauthenticated).

## Prerequisites

- Node.js 22+, npm
- PostgreSQL 16 — pick one:
  - **Local**, via the bundled compose file (`docker-compose.yml`), or
  - **Managed** — Neon, Supabase, RDS, etc. (recommended for production)

## Quickstart

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# Edit .env: at minimum set DATABASE_URL and SESSION_SECRET
#   openssl rand -hex 32   # → paste into SESSION_SECRET

# 3a. Local Postgres via Docker (or skip if you use managed Postgres)
docker compose up -d

# 3b. Create schema + seed demo data
npx prisma migrate deploy        # or: npx prisma migrate dev (creates a migration)
npm run db:seed                  # optional demo accounts (DEV ONLY)

# 4. Run
npm run dev                      # Next + Socket.io on http://localhost:3000
```

Open http://localhost:3000 and sign in with a demo account (see below).

## Environment setup

Every variable the app reads is documented in [`.env.example`](.env.example)
with dev values and production guidance — copy it to `.env` and fill in the
blanks. The essentials:

| Variable | Dev | Production |
|---|---|---|
| `DATABASE_URL` | `postgresql://avomessage:avomessage_dev_pw@localhost:5432/avomessage_dev` | Managed Postgres connection string (pooled) |
| `SESSION_SECRET` | any 32+ random bytes | **Generate fresh, store in your secret manager** |
| `APP_URL` | `http://localhost:3000` | `https://app.example.com` |
| `MAILER_DRIVER` | `log` | `resend` (+`RESEND_API_KEY`) or `smtp` (+`SMTP_*`) |
| `STORAGE_DRIVER` | `local` | `s3` (+`S3_*`) |
| `NEXT_PUBLIC_SOCKET_URL` | `http://localhost:3000` | `https://app.example.com` |
| `SOCKET_ALLOWED_ORIGINS` | unset (defaults to `APP_URL`) | `https://app.example.com` |
| `*_TURN_*` | unset | **Required**: TURN server for call reliability |

> **Never commit `.env`.** Never reuse dev secrets in production. See
> [`.env.example`](.env.example) for the full list (rate limits, CSP mode,
> WebRTC ICE, cleanup intervals).

## Database: migrate + seed

```bash
npx prisma migrate dev --name <change>  # dev: create + apply a migration
npx prisma migrate deploy               # prod/CI: apply pending migrations only
npx prisma generate                     # regenerate the client (after schema changes)
npm run db:seed                         # demo accounts + sample content (DEV ONLY)
```

The seed refuses to run with `NODE_ENV=production` unless `ALLOW_DEMO_SEED=1`
is set — and even then, **never seed production with demo accounts**.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server: Next.js + Socket.io via `tsx server.ts` |
| `npm run dev:next` | Plain `next dev` (no realtime; fast refresh only) |
| `npm run build` | Production Next.js build |
| `npm run build:server` | Compile `server.ts` → `dist-server/` (for `node`-only prod images) |
| `npm start` | Production: `NODE_ENV=production tsx server.ts` (refuses to boot without a `.next` build) |
| `npm run start:compiled` | Production via compiled `dist-server/server.js` (no `tsx` needed) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest suite (needs a Postgres DB; see below) |
| `npm run realtime:smoke` | Socket.io smoke test against a throwaway server |

Tests are DB-backed: point `DATABASE_URL` at a test database, run
`npx prisma migrate deploy`, then `npm test`. In CI this is a Postgres service
container (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Demo accounts (DEV ONLY — never in production)

Seeded by `npm run db:seed`. All emails end in `@avomessage.demo`.

| Email | Password | Role | Notes |
|---|---|---|---|
| `admin@avomessage.demo` | `Admin123!` | SUPER_ADMIN | Platform admin console |
| `manager@avomessage.demo` | `Manager123!` | USER + company manager | Manages the demo company "Avocado Labs" |
| `demo@avomessage.demo` | `Demo1234!` | USER | General demo user |
| `demo2@avomessage.demo` | `Demo1234!` | USER | `jules` — second demo user |
| `demo3@avomessage.demo` | `Demo1234!` | USER | `priya` — third demo user |

## Realtime server notes

`server.ts` creates one `http.Server`, attaches Socket.io, then delegates to
Next's request handler — **one port serves pages, API, and websockets**.
Details:

- Socket handshake authenticates via the `avo_session` cookie (same session as
  HTTP); `SOCKET_ALLOWED_ORIGINS` (or `APP_URL`) gates handshake origins.
- Namespaces/rooms: `user:{id}` (auto-joined), `conversation:{id}`,
  `company:{id}`, `call:{id}` — the server checks membership before joining.
- In-process 60s presence sweep covers sockets that vanished without a clean
  disconnect.
- If the `socket.io` package is missing, the server still boots with realtime
  disabled (loud warning) — useful for API-only deploys.
- Multi-instance note: presence, rate limits, and the idempotency cache are
  **in-memory** (single instance). For horizontal scaling, put Socket.io behind
  the Redis adapter and move rate limiting to Redis — the swap points are
  marked in `lib/realtime/server.ts` and `lib/rate-limit.ts`.

## Storage & mailer drivers

**Storage** (`STORAGE_DRIVER`, `lib/storage.ts`):
- `local` (dev): files under `STORAGE_LOCAL_DIR` (default `./storage/uploads`),
  served by `GET /uploads/[...path]`. MIME, extension, and size validated
  server-side.
- `s3` (prod): any S3-compatible store (AWS S3, MinIO, R2…). Set `S3_ENDPOINT`,
  `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and
  `S3_PUBLIC_URL` (CDN/public prefix).

**Mailer** (`MAILER_DRIVER`, `lib/mailer.ts`):
- `log` (dev default): prints to console and saves HTML to
  `./storage/mail/<timestamp>-<tag>.html` (override with `MAILER_LOG_DIR`).
- `resend`: needs `RESEND_API_KEY` (+`SMTP_FROM` as the sender).
- `smtp`: needs `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM`
  (`SMTP_PORT` default 587, `SMTP_SECURE=1` forces TLS).

**Calls** (`lib/webrtc/ice-config.ts`): `NEXT_PUBLIC_STUN_URL` (default
`stun:stun.l.google.com:19302`); `NEXT_PUBLIC_TURN_URL/_USERNAME/_CREDENTIAL`
for TURN. **Production requires TURN** behind symmetric NATs. Static
long-lived TURN credentials must not ship in the client bundle long-term —
mint ephemeral TURN REST credentials from an authenticated endpoint
(`docs/SECURITY_REVIEW.md` §5).

## Deployment checklist

Full step-by-step runbook: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
Summary:

- [ ] Managed Postgres (Neon/Supabase/RDS); `DATABASE_URL` uses the **pooled**
      connection string; run `npx prisma migrate deploy` (never `migrate dev`)
- [ ] `SESSION_SECRET`: fresh 32+ random bytes in a secret manager; rotation
      logs everyone out
- [ ] `NODE_ENV=production`, `APP_URL`/`NEXT_PUBLIC_SOCKET_URL` set to the
      public HTTPS origin; `SOCKET_ALLOWED_ORIGINS` set
- [ ] TLS terminated at the proxy/CDN; HSTS is sent automatically in prod
- [ ] `MAILER_DRIVER=resend|smtp` with credentials (dev `log` driver never in prod)
- [ ] `STORAGE_DRIVER=s3` with bucket + credentials; uploads not stored on
      ephemeral disk
- [ ] TURN server configured (`NEXT_PUBLIC_TURN_URL/_USERNAME/_CREDENTIAL`);
      plan ephemeral credential minting
- [ ] Build: `npm ci && npx prisma generate && npm run build`
      (+ `npm run build:server` for the compiled path)
- [ ] Start: `npm start` (`tsx server.ts`) or `npm run start:compiled`;
      process manager (systemd/Docker/Fly/Render) restarts on crash
- [ ] Health checks: HTTP `GET /api/health` (200 = healthy); alert on 503
- [ ] Backups: nightly `pg_dump` (procedure below); test restores
- [ ] Reverse proxy: gzip/brotli + static-asset caching; forward
      `X-Forwarded-For` for rate limiting/IP logging
- [ ] `CSP_MODE=enforce` (default); use `report-only` first if rolling out
      against an existing domain

## Backup & restore (PostgreSQL)

```bash
# Backup (nightly via cron/systemd timer; compress + offsite the artifact)
pg_dump --format=custom --file=avomessage-$(date +%F).dump "$DATABASE_URL"

# Restore into a fresh database
createdb avomessage_restore
pg_restore --dbname="$RESTORE_URL" avomessage-2026-10-03.dump

# Plain-SQL alternative (simpler, slower for large DBs)
pg_dump --format=plain --file=backup.sql "$DATABASE_URL"
psql "$RESTORE_URL" < backup.sql
```

Notes:
- Always restore into an **empty** database; the restored schema must match
  the app's migrations (re-run `npx prisma migrate deploy` expectations).
- Keep at least one tested restore: an untested backup is not a backup.
- For managed Postgres (Neon/Supabase/RDS), prefer the provider's automated
  backups + point-in-time recovery; keep `pg_dump` as a portable fallback.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `SESSION_SECRET must be set…` on boot | `.env` missing or not loaded — copy `.env.example` → `.env` |
| `DATABASE_URL is not set` | Same as above; vitest loads `.env` via `tests/setup.ts` |
| Prisma `P1001` can't reach DB | Postgres down / wrong host; `docker compose up -d`; check `pg_isready` |
| `npm start` exits "No .next build found" | Run `npm run build` first (the `prestart` guard) |
| `/api/health` → 503 `degraded` | DB unreachable — check `DATABASE_URL`, network, pool limits |
| Socket.io won't connect in prod | `NEXT_PUBLIC_SOCKET_URL` / `SOCKET_ALLOWED_ORIGINS` still localhost |
| 403 `CSRF_INVALID` on mutations | Client must send `x-csrf-token` header matching the `avo_csrf` cookie |
| Emails never arrive (dev) | `log` driver — check console and `./storage/mail/` |
| Uploads 404 after redeploy | `local` driver on ephemeral disk — switch to `s3` in prod |
| Calls connect on same Wi-Fi but not across networks | No TURN server — configure `NEXT_PUBLIC_TURN_*` |
| `address already in use` | Another server on `$PORT` — `fuser -k 3000/tcp` or set `PORT` |
| Stale `tsconfig.tsbuildinfo` type errors | Delete `tsconfig.tsbuildinfo` and re-run typecheck |

## License

Private — all rights reserved (add a license file before distributing).
