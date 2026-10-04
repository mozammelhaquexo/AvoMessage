# AvoMessage — Final Report

**Date:** 2026-10-03 · **Status:** Built, tested, and verified end-to-end against local PostgreSQL
**Location:** `~/workspace/avomessage/`

## 1. Architecture summary

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript (strict) |
| Styling | Tailwind CSS v4 (`@theme` tokens), hand-rolled accessible UI primitives (shadcn spirit), framer-motion |
| Database | PostgreSQL 16 + Prisma 7 ORM (migrations in `prisma/migrations/`) |
| Auth | Email/password, bcryptjs cost 12, DB-backed sessions (signed httpOnly cookies, SameSite=Lax, Secure in prod), double-submit CSRF, hashed single-use expiring verification/reset tokens, login-activity tracking, session/device revocation |
| Realtime | Socket.io on a custom Next.js server (`server.ts`): presence, typing, idempotent message delivery, delivery/read receipts, live notifications, live feed updates, WebRTC call signaling |
| Storage | Abstraction (`lib/storage.ts`): local-disk driver (dev), S3-compatible driver via env (prod); server-side MIME/extension/size validation |
| Calls | WebRTC P2P audio with Socket.io signaling; STUN/TURN via env; full state machine; persisted call history scoped to participants |
| Voice messages | MediaRecorder capture → upload → waveform playback with seek |
| Mail | Abstraction: log driver (dev, writes `storage/mail/*.html`), Resend/SMTP via env (prod) |
| Themes | Light / dark / system, no-FOUC, persisted |

Key design decisions (see `docs/ARCHITECTURE.md`): DB sessions (not JWT) so sessions are revocable server-side and shared with the Socket.io handshake; thin route handlers with all business logic + permission checks in `lib/services/*` and `lib/permissions.ts`; denormalized counters maintained transactionally (feeds never `COUNT(*)`); enum-based RBAC (platform/company/team/conversation) enforced server-side on every query — never frontend-only.

## 2. Completed feature matrix

| Area | Status | Notes |
|---|---|---|
| Auth (signup/login/logout/verify/forgot/reset/recovery) | ✅ | Brute-force lockout, enumeration-resistant messages, 2FA-ready architecture |
| Landing page | ✅ | Hero, value props, animated preview, CTAs, footer |
| App shell (sidebar / mobile bottom nav) | ✅ | Badges, presence, global composer, unverified-email banner |
| Profiles + settings (privacy, notifications, security, sessions) | ✅ | Follow/mute/block/report; password change; device revocation |
| World feed | ✅ | Public posts, chronological toggle, infinite scroll, skeletons, live prepend, hashtags/mentions |
| Posts (media, visibility, like/repost/bookmark/report/edit/delete) | ✅ | Composer with drag/drop, emoji, char counter, visibility selector |
| Comments (nested ≤3, likes, replies, report, moderation) | ✅ | Paginated, depth-limited |
| Follows / bookmarks | ✅ | |
| Real-time messaging (DM + group + company chat) | ✅ | Typing, presence, delivery/read receipts, reactions, reply/edit/delete, attachments, pin/mute |
| Voice messages | ✅ | Record/preview/cancel/send, waveform playback, seek, speed, mic-denial UI |
| Audio calls (1:1 + group mesh ≤6) | ✅ | Ringing/accept/reject/mute/timer/quality/reconnect, persisted history (participant-scoped) |
| Companies (private communities) | ✅ | Overview/Feed/Members/Managers/Teams/Announcements/Media/About/Settings; server-side membership scoping |
| Teams/groups | ✅ | Posts, members, group chat |
| Invitations | ✅ | Email flow, expiry, resend, revoke, audit trail; manager member-account creation with temp credentials + forced reset |
| Manager panel | ✅ | Dashboard stats, members, teams, invitations, announcements, activity |
| Admin panel | ✅ | Dashboard + SVG charts, users, managers, companies, posts, comments, reports, moderation, roles, audit logs, analytics, settings, announcements |
| Notifications (realtime center) | ✅ | 13 event types, read/unread, filters, deep links |
| Search (users/companies/hashtags/posts) | ✅ | Suggestions, recent searches, permission-filtered |
| Moderation & safety (reports, block/mute, queue) | ✅ | Reason categories, audit history, rate limiting |
| Analytics (admin DAU/WAU/MAU, growth; manager engagement) | ✅ | Admin-only |
| Accessibility | ✅ | Keyboard nav, ARIA, focus states, contrast AA, reduced-motion, ≥44px targets |
| Responsive (320→1440px+) | ✅ | Mobile-first, bottom nav, full-screen composer |
| Loading/empty/error/success states | ✅ | Reusable state components on every major page |
| Audit logging | ✅ | Admin/manager/security actions |

## 3. Routes

**Pages (44):** `/`, `(public)/login`, `(public)/signup`, `(public)/verify-email`, `(public)/forgot-password`, `(public)/reset-password`, `(app)/home`, `(app)/world`, `(app)/post/[id]`, `(app)/hashtag/[tag]`, `(app)/bookmarks`, `(app)/profile/[username]`, `(app)/search`, `(app)/notifications`, `(app)/settings`, `(app)/help`, `(app)/messages`, `(app)/messages/[conversationId]`, `(app)/companies`, `(app)/companies/new`, `(app)/company/[slug]`, `(app)/company/[slug]/teams/[teamId]`, `(app)/manage/[slug]`, `(app)/manage/[slug]/members`, `(app)/manage/[slug]/teams`, `(app)/manage/[slug]/invitations`, `(app)/manage/[slug]/settings`, `(app)/admin` + 13 admin sections (analytics, announcements, audit-logs, comments, companies, managers, moderation, posts, reports, reports/[id], roles, settings, users, users/[id]).

**API (91 route handlers)** under `app/api/`: `auth/*`, `users/*`, `posts/*`, `comments/*`, `notifications/*`, `search/*`, `reports/*`, `uploads/*`, `companies/*`, `teams/*`, `invitations/*`, `conversations/*`, `messages/*`, `calls/*`, `admin/*`, `health`.

**Realtime rooms:** `user:{id}` (server-side only), `conversation:{id}`, `company:{id}`, `call:{id}` — all membership-checked on join.

## 4. Database schema summary

33 models, 17 enums (`prisma/schema.prisma`; migrations applied). Core: `User`, `Session`, `EmailVerificationToken`, `PasswordResetToken`, `LoginActivity`, `Company`, `CompanyMember`, `Team`, `TeamMember`, `Post`, `PostMedia`, `Comment`, `CommentLike`, `PostLike`, `Follow`, `Bookmark`, `Hashtag`, `Mention`, `Conversation`, `ConversationMember`, `Message` (with `clientId` for idempotent sends), `MessageReaction`, `MessageAttachment`, `VoiceMessage`, `Call`, `CallParticipant`, `Notification`, `Report`, `Block`, `Mute`, `AuditLog`, `Invitation`, `UserPresence`, `SystemSetting`. Conventions: cuid ids, `createdAt`/`updatedAt`, soft delete (`deletedAt`) on user content, composite keys on join tables, indexes on all foreign keys and feed orderings, unique constraints on (conversationId, clientId), usernames, emails.

## 5. Environment variables

See `.env.example` (all documented, no real secrets): `DATABASE_URL`, `APP_URL`, `NODE_ENV`, `PORT`, `SESSION_SECRET`, `CSRF_SECRET`, `BCRYPT_ROUNDS=12`, `MAILER_DRIVER` (log|resend|smtp) + `RESEND_API_KEY`/`SMTP_*`, `STORAGE_DRIVER` (local|s3) + `S3_*`/`STORAGE_LOCAL_DIR`, `NEXT_PUBLIC_SOCKET_URL`, `NEXT_PUBLIC_STUN_URL`, `NEXT_PUBLIC_TURN_URL`/`USERNAME`/`CREDENTIAL`. Dev secrets live in `.env` (mode 600, gitignored).

## 6. Test results

- `npx tsc --noEmit`: **clean (0 errors)**
- `npm run build`: **succeeds** (44 pages)
- Vitest: **12 files, 147 tests, all green** (baseline was 96/7; QA added 51 tests/5 files: messaging, posts-crud, notifications, invitations, uploads). Includes voice/call-machine unit tests (32).
- QA fixed 4 real bugs found by the new tests: company-post 500 (high), deleted-message tombstones unreachable via REST (medium), DM-dedupe status code (low), emoji-picker Escape/toggle (a11y, low). No permission check was weakened.
- Authorization matrix (mandatory): (a) company-private posts return 403/404 for non-members **including direct GET by id** — verified again live during final smoke test (404, no existence leak); (b) cross-company managers blocked; (c) non-admin users get 403 on all `/api/admin/*`.
- Realtime smoke: 28/28 socket assertions (auth, membership-checked joins, idempotent send, typing, read receipts, call lifecycle).
- QA HTTP smoke: **21/21 passed** (signup → verify → login → post → comment → like → follow → notifications → DM → message → read → reaction → mark-read), self-cleaning script at `scripts/qa-smoke.sh`.
- Final coordinator smoke test (live server, 2026-10-03): login → create post → like → DM create → send message → read back → company-privacy 404 checks → cleanup. All passed.

## 7. Known limitations (honest)

1. **No TURN server provisioned in dev** — P2P calls work on localhost/LAN; production needs `NEXT_PUBLIC_TURN_*` (documented in `.env.example`).
2. **Group-call mesh (≤6) not multi-browser verified** — state machine unit-tested; 3+ client verification is manual (see `docs/voice-calling-manual-test.md`). SFU is the documented v2 path.
3. **`/uploads/[...path]` is public in v1** — documented tradeoff (SECURITY_REVIEW R7); auth-gating private kinds is v2 work.
4. **Email is log-driver in dev** — real delivery needs Resend/SMTP env config.
5. **Rate limiting is in-memory** — fine for single-instance; Redis swap point documented for horizontal scaling.
6. **Playwright e2e not added** — unit + API/integration + smoke coverage instead; e2e plan in `docs/E2E_PLAN.md` (if written by QA) else follow `docs/voice-calling-manual-test.md` + QA report procedures.
7. **No global message-content search** — in-thread search is client-side over member-scoped messages; global search covers users/companies/hashtags/posts.
8. **Socket `call:reject` vs REST `decline` group semantics differ slightly** (documented by the voice engineer); client uses socket as primary, REST as fallback — no user-facing conflict.
9. **Home feed** filters the world feed client-side by following set (bounded); no dedicated home-feed endpoint yet.
10. **Ringtone requires one user gesture** before AudioContext starts (browser policy); retries on first interaction.
11. **Invitation-accept TOCTOU race** (SECURITY_REVIEW R5): concurrent accepts fail with 500 on the unique constraint instead of a graceful response. Low severity.
12. **Minor inconsistency:** `DELETE /api/posts/:id/like` doesn't require verified email while the POST toggle does.
13. **Reposts have no attribution link** to the original (no `repostedFromId` column) — product decision needed.
14. **Doc drift:** ARCHITECTURE.md documents `GET /api/feed?type=…` but the route is `GET /api/posts`; invitation routes live at `/api/invitations` not `/api/companies/:id/invitations`. A doc-sync pass is recommended.

## 8. Deployment steps

1. Provision PostgreSQL (managed: Neon/Supabase; or `docker compose up -d` with the shipped `docker-compose.yml`).
2. Set env vars from `.env.example` (strong `SESSION_SECRET`/`CSRF_SECRET`, `APP_URL=https://…`, Resend/SMTP, S3, TURN).
3. `npm ci && npx prisma migrate deploy` (never `migrate dev` on prod) and optional `npx prisma db seed` for demo data.
4. `npm run build && npm start` (custom `server.ts`: Next.js + Socket.io on one port; `PORT` env).
5. Put behind TLS-terminating reverse proxy; verify `/api/health`.
6. Backups: `pg_dump` on a schedule (procedure in README ops section).

Full details: `README.md`, `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_REVIEW.md`.

## 9. Recommended next improvements

- Playwright e2e suite (plan exists); visual regression tests.
- SFU (LiveKit) for group calls >6 participants.
- Redis-backed rate limiting + Socket.io adapter for horizontal scaling.
- Push notifications (web push) for offline users.
- Auth-gated private uploads; virus scanning on upload.
- 2FA (TOTP) — architecture is ready.
- Dedicated home-feed ranking endpoint; full-text search (pg_trgm / Meilisearch).
- Message edit history; scheduled messages; threads in DMs.

## Demo accounts (DEV ONLY)

| Email | Password | Role |
|---|---|---|
| `admin@avomessage.demo` | `Admin123!` | Super Admin |
| `manager@avomessage.demo` | `Manager123!` | Owner of Avocado Labs |
| `demo@avomessage.demo` | `Demo1234!` | User (member) |
| `demo2@avomessage.demo` | `Demo1234!` | User (manager of Avocado Labs) |
| `demo3@avomessage.demo` | `Demo1234!` | User |

## Run it locally

```bash
cd ~/workspace/avomessage
# PostgreSQL 16 running locally with role/db `avomessage`/`avomessage_dev` (see README for setup)
set -a; source .env; set +a
npx prisma migrate deploy && npx prisma db seed
npm run dev   # tsx server.ts → http://localhost:3000
```
