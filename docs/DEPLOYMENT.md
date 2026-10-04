# AvoMessage — Production Deployment

Step-by-step runbook for taking AvoMessage from a built repo to a healthy
production deployment. Companion to the checklist in
[`README.md`](../README.md#deployment-checklist).

## 0. What you're deploying

- **App server**: `server.ts` — Next.js + Socket.io on **one** HTTP port
  (default 3000). Two ways to run it (pick one):
  - `npm start` → `NODE_ENV=production tsx server.ts` (needs `tsx`, ships in
    devDependencies — fine for most hosts)
  - `npm run build:server && npm run start:compiled` → plain
    `node dist-server/server.js` (slimmer prod images, no tsx at runtime)
- **Database**: PostgreSQL 16 (managed in prod — Neon, Supabase, RDS…).
- **Stateless app tier**: sessions live in the DB, so the app itself holds no
  durable state — except in-memory presence/rate-limit caches (single-instance
  only; see §7).

## 1. Provision infrastructure

1. **Postgres**: create a managed Postgres 16 database. Copy the **pooled**
   connection string (PgBouncer / pooler mode) — serverless/edge hosts and
   high connection churn need it.
2. **S3-compatible storage**: bucket for uploads (AWS S3, R2, MinIO…).
   Create an access key pair scoped to that bucket.
3. **Mailer**: Resend API key **or** SMTP credentials with a verified sender.
4. **TURN server** (required for reliable calls): coturn or a managed TURN
   service. Note the server URL + credentials.
5. **(Optional) Redis** — only if you plan >1 app instance (§7).

## 2. Configure secrets

Set these in your host's secret manager / env config — never in the repo:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Pooled Postgres connection string |
| `SESSION_SECRET` | `openssl rand -hex 32` (fresh; rotation logs everyone out) |
| `RESEND_API_KEY` or `SMTP_*` | Mail provider credentials |
| `S3_*` | Bucket endpoint/region/keys |
| `NEXT_PUBLIC_TURN_*` | TURN URL + credentials |

And the non-secret config:

```bash
NODE_ENV=production
APP_URL=https://app.example.com
NEXT_PUBLIC_SOCKET_URL=https://app.example.com
SOCKET_ALLOWED_ORIGINS=https://app.example.com
MAILER_DRIVER=resend            # or smtp
STORAGE_DRIVER=s3
PORT=3000
HOSTNAME=0.0.0.0
```

See [`.env.example`](../.env.example) for every variable with prod guidance.

## 3. Build

```bash
npm ci
npx prisma generate
npx prisma migrate deploy   # applies pending migrations; never `migrate dev` in prod
npm run build
# compiled-server path only:
npm run build:server
```

Verify the build locally before shipping: `npm start`, then
`curl http://localhost:3000/api/health`.

## 4. Database migrations

- **Deploy**: `npx prisma migrate deploy` (idempotent; safe to run on every
  deploy before starting the new version).
- **New schema change**: author with `npx prisma migrate dev` in development,
  commit the migration SQL, then `migrate deploy` in staging → production.
- Migrations in this repo: `prisma/migrations/`.

## 5. Start the server

```bash
npm start                  # tsx path
# or
npm run start:compiled     # compiled dist-server path
```

Run under a process manager that restarts on crash and captures stdout:

- **systemd**: `Restart=always`, `EnvironmentFile=/etc/avomessage/env`.
- **Docker**: `CMD ["npm", "run", "start:compiled"]` after a multi-stage build
  (`npm ci` → `prisma generate` → `npm run build` → `npm run build:server` →
  copy `.next`, `dist-server`, `prisma`, `public`, `package.json`).
- **PaaS** (Render/Fly/Railway): build command `npm ci && npx prisma generate
  && npx prisma migrate deploy && npm run build`; start command `npm start`.

Graceful shutdown: the server handles `SIGINT`/`SIGTERM` (closes sockets,
clears timers, 10s force-exit backstop).

## 6. Reverse proxy / TLS

Terminate TLS at the proxy (nginx, Caddy, Cloudflare). In production the app
sends `Strict-Transport-Security` and `upgrade-insecure-requests` automatically.

- Forward `X-Forwarded-For` (rate limiting and login-activity IPs trust it).
- Enable gzip/brotli and long-cache static assets (`/_next/static/*` is
  content-hashed — cache immutably).
- WebSocket upgrade must be allowed on the same host/port (`/socket.io/`).

## 7. Health checks & monitoring

- **Liveness/readiness**: `GET /api/health` (unauthenticated).
  - `200 { status: "ok", db: { ok: true, latencyMs } }` → healthy.
  - `503 { status: "degraded", db: { ok: false } }` → DB unreachable; alert.
- Point your orchestrator/load balancer at it; alert on non-200.
- Logs: the server logs to stdout (request errors, realtime warnings,
  presence-sweep failures). Ship to your log aggregator. To cut fetch-URL
  noise in prod logs, `next.config.ts` already sets
  `logging.fetches.fullUrl: false` when `NODE_ENV=production`.
- **Scaling past one instance**: presence, the rate-limit token bucket, and
  the message idempotency cache are in-memory. Before adding a second
  instance: (a) put Socket.io behind the Redis adapter (`lib/realtime/server.ts`
  marks the spot), (b) move rate limiting to Redis (`lib/rate-limit.ts` has the
  swap recipe), (c) use sticky sessions or the Redis adapter for socket rooms.

## 8. Backups

Nightly `pg_dump` in custom format, compressed, copied offsite:

```bash
pg_dump --format=custom --file=/backups/avomessage-$(date +%F).dump "$DATABASE_URL"
```

Restore into an **empty** database and verify the app boots against it:

```bash
createdb avomessage_restore
pg_restore --dbname="$RESTORE_URL" /backups/avomessage-2026-10-03.dump
```

- Test a restore at least once — an untested backup is not a backup.
- On managed Postgres, prefer the provider's automated backups + point-in-time
  recovery; keep `pg_dump` as the portable fallback.
- Also back up the S3 bucket (versioning or cross-region replication).

## 9. Security hardening recap

Covered in [`docs/SECURITY_REVIEW.md`](SECURITY_REVIEW.md); the deploy-relevant
bits:

- Security headers are set in `next.config.ts` (HSTS prod-only); the
  per-request CSP nonce comes from `proxy.ts`. `CSP_MODE=enforce` is the
  default — use `report-only` while validating against your domain, then flip.
- Cookies: `HttpOnly; Secure (prod); SameSite=Lax`.
- CSRF: double-submit (`avo_csrf` cookie + `x-csrf-token` header) enforced in
  `proxy.ts` and in `lib/api.ts`'s `handle()`.
- Rate limits are in-memory per instance (see §7 before scaling).
- `BCRYPT_ROUNDS` ≥ 10 (default 12).
- Never run the demo seed in production (`prisma/seed.ts` refuses unless
  `ALLOW_DEMO_SEED=1`).

## 10. Rollback

1. `git checkout <previous-tag>` (or redeploy the previous image).
2. `npm ci && npx prisma generate && npm run build && npm start`.
3. If the bad deploy included a migration, restore the DB from the pre-deploy
   `pg_dump` — Prisma migrations don't auto-roll-back; down-migrations are a
   manual, reviewed SQL affair.

## 11. First-deploy smoke test

```bash
curl -s http://localhost:3000/api/health | jq .status   # expect "ok"
npm run realtime:smoke                                   # socket.io round-trip
```

Then in a browser: sign up → verify email (check the mailer) → post →
message → upload an image → start a call (needs TURN for cross-network).
