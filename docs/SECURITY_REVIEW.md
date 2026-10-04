# AvoMessage — Security Review (Agent 07)

**Date:** 2026-10-03 · **Reviewer:** Security Engineer (build agent 07)
**Scope:** auth/session, CSRF, authorization, input/output, secrets, headers,
rate limiting, audit logging — review AND fix.
**Working tree:** `~/workspace/avomessage`

**Bottom line:** the security architecture is sound and matches
`docs/ARCHITECTURE.md` / `docs/RBAC.md` — bcrypt cost 12, DB sessions with
hashed tokens + signed cookies, double-submit CSRF on all mutating routes,
server-side authorization with an authorization-matrix test suite (96/96
green at final check). This pass fixed 6 security issues (1 medium, 5 low)
plus all pre-existing `tsc` errors blocking the acceptance gate. No hardcoded
secrets. Security headers and a nonce-based CSP are now in place.

> **Concurrency note:** sibling build agents were editing the tree in parallel
> during this review (frontend components, new tests). Several `tsc` errors
> below were fixed by them mid-review; where our edits overlapped (e.g.
> `components/search/SearchBar.tsx`, `apiGet` call sites) the sibling's fuller
> version was kept. The orchestrator should re-run `tsc` + vitest at
> integration time — the tree was green at the moment this review finished.

---

## 1. Findings

### Fixed

| # | Severity | Finding | Location | Fix |
|---|----------|---------|----------|-----|
| F1 | **Medium** | **Login timing oracle for account enumeration.** Unknown-email logins returned instantly while wrong-password logins burned ~250ms of bcrypt, letting an attacker distinguish "no such account" from "wrong password" by timing. | `lib/services/auth.ts` → `login()` | Added `burnDummyPasswordCompare()` (`lib/auth/password.ts`): the unknown-email path now runs a real bcrypt comparison against a throwaway hash before returning the generic `INVALID_CREDENTIALS` error. Both outcomes cost the same. |
| F2 | **Low** | **No security headers.** `next.config.ts` was empty — no HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`. | `next.config.ts` | Added via `headers()`: `nosniff`, `X-Frame-Options: DENY`, `strict-origin-when-cross-origin`, `Permissions-Policy` (`camera=(self), microphone=(self)`, rest denied — calls/voice need mic+camera), `X-DNS-Prefetch-Control: off`, `Cross-Origin-Opener-Policy: same-origin`, HSTS (production only; localhost dev is plain HTTP). |
| F3 | **Low** | **No Content-Security-Policy.** Only `dangerouslySetInnerHTML` is the static theme script (`lib/theme.tsx`); Next.js also emits inline bootstrap/RSC scripts, so a naive `script-src 'self'` would break the app. | `middleware.ts`, `lib/theme.tsx`, `app/layout.tsx` | Nonce-based CSP per the official Next.js pattern: middleware generates a 128-bit nonce per request, exposes it via the `x-nonce` request header (root layout reads it with `headers()` and passes it to `<ThemeScript nonce>`) and sets `Content-Security-Policy`: `script-src 'self' 'nonce-…' 'strict-dynamic'` (Next.js applies `x-nonce` to its own inline scripts), `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob: https:`, `connect-src 'self' ws: wss: https:` (socket.io), `media-src 'self' blob: https:`, `object-src 'none'`, `frame-ancestors 'none'`, `upgrade-insecure-requests` in prod. Escape hatch: `CSP_MODE=report-only\|off` (documented in `.env.example`). Middleware matcher extended from `/api/:path*` to all routes; the CSRF check stays gated on `/api/` + unsafe methods, so page behavior is unchanged. **Follow-up:** Next.js 16.3.8 deprecates the `middleware.ts` file convention in favor of `proxy.ts` (startup warning observed; the file still works). Migrate with `npx @next/codemod@canary middleware-to-proxy .` before the convention is removed, then re-verify CSP/CSRF headers. |
| F4 | **Low** | **Upload-serving route missing `X-Content-Type-Options`.** `GET /uploads/[...path]` serves user files; without `nosniff` a hostile file could be reinterpreted (stored-XSS vector if validation is ever bypassed). | `app/api/uploads/[...path]/route.ts` | Added `X-Content-Type-Options: nosniff`. (Upload validation itself is strong: MIME allowlist + extension + magic-byte sniffing matched against the *declared* MIME, SVG rejected, size caps, sanitized filenames, path-traversal-safe key resolution.) |
| F5 | **Low** | **Demo seed had no production guard.** `prisma/seed.ts` creates a SUPER_ADMIN with a publicly documented password (`Admin123!`); nothing stopped it running against a production database. | `prisma/seed.ts` | `main()` now refuses when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=1` is set. Seed passwords remain clearly-marked demo credentials per spec. |
| F6 | **Low** | **Latent client-bundle secret footgun.** `lib/webrtc/ice-config.ts` documents `NEXT_PUBLIC_TURN_USERNAME` / `NEXT_PUBLIC_TURN_CREDENTIAL`; static TURN credentials in the client bundle are visible to everyone. (Currently dormant — not imported anywhere; the call UI isn't built yet.) | `lib/webrtc/ice-config.ts` | Added a SECURITY NOTE requiring ephemeral TURN credentials minted by an authenticated endpoint (TURN REST API scheme) when the call UI is built, keeping the shared secret server-side. See residual risk R4. |

### Pre-existing `tsc` errors fixed (acceptance gate)

`npx tsc --noEmit` was failing (a stale `tsconfig.tsbuildinfo` initially
masked the true count; a clean recheck showed the real set). All were fixed
minimally with no behavior change; several overlapping ones were fixed by
sibling agents in parallel — this list reflects the final state:

- `lib/chat.ts` — socket author payload lacked `createdAt` required by
  `PublicUser`; falls back to the message timestamp (sender object is
  display-only: name/avatar/username).
- `lib/voice/recorder.ts` — `reject` invoked without null guard (guarded
  alongside the existing `resolve` check).
- `lib/webrtc/ice-config.ts` — `process.env` narrowed to `{}`; typed as
  `Record<string, string | undefined>`.
- `lib/realtime/client.tsx` — `sendMessage` input required `AttachmentPayload[]`
  (with `id`), but the composer produces id-less attachments and the socket
  `attachmentInput` schema takes no `id`. Input type now accepts optional ids;
  optimistic messages get `local:<clientId>:<i>` ids; the server still assigns
  real ids on persist.
- `components/chat/ChatWindow.tsx`, `components/chat/MessagesView.tsx`,
  `components/admin/AdminUsers.tsx` — `onConfirm={() => x && void f()}`
  returned `null`, incompatible with `void | Promise<void>`; wrapped in
  braces. `onLeave` made `async` to match `(id) => Promise<void>`.
- `components/layout/AppShell.tsx` — `apiGet(…, { limit })` →
  `{ params: { limit } }` (matches `ApiFetchOptions`);
  `<PostComposer global onCreated>` → `<PostComposer onPosted>`
  (matches `PostComposerProps`; personal feed is the default).
- `components/companies/CompanyWorkspace.tsx` — `postToSummary` was missing
  its closing brace (syntax error swallowing the rest of the file).
- `components/search/SearchBar.tsx` — **created** (was missing; imported by
  `RightPanel.tsx`). A sibling agent later replaced it with a fuller
  autocomplete version; kept theirs.
- `apiGet` query-arg fixes (`{ cursor|limit|q }` → `{ params: {...} }`) in
  `CommentThread`, `NotificationCenter`, `PostComposer`, `PostFeed` call sites
  and `app/(app)` pages (bookmarks, hashtag, home, profile, search, settings,
  world) — mostly landed by the sibling agent; verified green here.
- `components/posts/PostFeed.tsx` — `emptyIcon` widened to `IconName`
  (it is passed straight to `EmptyState`).
- `components/ui/form-field.tsx` — `hint?: string` → `ReactNode` (login page
  passes a "Forgot password?" link).
- `components/manage/ManageDashboard.tsx` — added missing `apiPost` import.
- `components/notifications/NotificationCenter.tsx` — socket
  `NotificationPayload` → `NotificationItem` normalization when merging live
  arrivals (adds `isVerified: false` default, narrows `type`).
- `components/chat/ChatComposer.tsx` — `UploadedVoice` imported from
  `@/lib/voice/upload` (its actual home) instead of `@/components/voice`.
- Deleted the stale `.next/` build cache (its `types/validator.ts`
  referenced a non-existent `app/page.js`); regenerated via `next dev`
  (landing page lives at `app/(public)/page.tsx`).

### Verified — no change needed

- **bcrypt cost 12** (`lib/auth/password.ts`; `BCRYPT_ROUNDS` env-overridable,
  floor 10). **Session tokens:** 32-byte `randomBytes`, SHA-256 stored
  (`Session.tokenHash`), cookie `avo_session=<raw>.<sig>` with
  HMAC-SHA256/`SESSION_SECRET` verified in constant time.
  **Cookie flags:** `HttpOnly; Secure` (prod); `SameSite=Lax`; `Path=/`;
  `Max-Age=30d`. **Sliding refresh:** 30d, debounced to 1 write/5 min.
  **Revocation:** logout, revoke-one, revoke-others, revoke-all (password
  reset, suspension) — all set `revokedAt`.
- **Lockout:** 5 failed logins / 15 min / account → 423 `ACCOUNT_LOCKED`
  (15-min window); every attempt → `LoginActivity` row.
- **Enumeration resistance:** login returns identical `INVALID_CREDENTIALS`
  for unknown email vs wrong password (plus F1 timing fix); `forgot-password`
  always `{ ok: true }`; `verify-email`/`reset-password` use generic
  `TOKEN_INVALID/EXPIRED/USED` codes. Deliberate exceptions per spec:
  `ACCOUNT_SUSPENDED` / `ACCOUNT_LOCKED` / `EMAIL_UNVERIFIED` are distinct
  codes by design (needed for client UX).
- **CSRF:** double-submit (`avo_csrf` cookie + `x-csrf-token` header,
  constant-time compare) enforced in **both** `middleware.ts` (net) and
  `handle()` in `lib/api.ts` (per-route, testable). All mutating routes go
  through `handle()`; only pre-auth routes opt out (`csrf: false`:
  signup/register, login, verify-email, forgot/reset-password — correct,
  they have no session yet). **Socket handshake:** origin allowlist
  (`SOCKET_ALLOWED_ORIGINS`/`APP_URL`) + session-cookie verification in
  `io.use()`; all handlers use `socket.data.userId`, never client-supplied ids;
  room joins are membership-checked; per-user rate limits on events.
- **Authorization spot-checks:** every `/api/admin/*` route → service-level
  `assertAdmin` (defense in depth; matrix test proves non-admins get 403 on
  all admin routes); `PATCH /api/users/[username]` limited to self
  (`user.username !== username` → 403); message edit = sender + 15-min window
  (`MESSAGE_EDIT_WINDOW_MS`); company-post list/create enforce
  `requireCompanyMember` **in the Prisma query** (`companyId` in `where`,
  members can't see others' `PRIVATE` posts); invitation accept binds token →
  email-match → single-use `ACCEPTED` status; role-change invariants
  (last-owner protection, ADMIN can't touch ADMIN+) in services.
- **Input/output:** zod schemas on all API inputs (`lib/validation.ts`,
  parsed via `parseJson`); no `dangerouslySetInnerHTML` with user content
  (only the static theme script); no `javascript:` URLs; React escapes all
  rendered user content (`renderRichText` returns React nodes, no raw HTML).
- **Tokens:** verification (24h) / password-reset (1h) / invitation (7d) —
  32-byte, SHA-256-hashed at rest, single-use (`usedAt`/`ACCEPTED`), consumed
  transactionally; reset revokes all sessions + sends a security-alert email.
- **Uploads:** `POST /api/uploads` requires session + verified email, `upload`
  rate limit (20/hr); server-side validation before `put` (see F4).
- **Secrets:** no hardcoded secrets in code (only documented demo passwords in
  `prisma/seed.ts`, bcrypt-hashed, dev-only); `.env` is gitignored (`.env*`
  in `.gitignore`, mode 600, local dev values); `.env.example` contains only
  placeholders. **Client bundle:** the only `NEXT_PUBLIC_*` vars referenced
  are WebRTC/ICE settings (STUN URL public by nature; TURN credential vars are
  dormant — see F6/R4). `NEXT_PUBLIC_SOCKET_URL` in `.env.example` is unused
  (dead var, harmless).
- **Rate limits:** `auth` 10/min (login, forgot/reset, verify), `register`
  5/hr/IP (explicit on signup), `write` 60/min, `read` 300/min, `upload`
  20/hr (explicit), resend-verification 60s cooldown, per-IP buckets,
  `Retry-After` on 429, Redis swap documented.
- **Audit logging:** 40+ `writeAuditLog` call sites covering account
  create/verify/password change/reset, session revocations, company
  create/update/deactivate, member add/remove/role-change, team CRUD +
  membership, invitation create/resend/revoke/accept, announcements,
  conversation member add/remove, admin user updates/suspends, role changes,
  report resolution, moderation actions, settings updates. Writes are
  best-effort (never break the operation).

---

## 2. Verification steps

```bash
cd ~/workspace/avomessage
npx tsc --noEmit          # clean (final state; see concurrency note above)
npx vitest run            # 96/96 green, 7 files (includes authorization-matrix,
                          # company-privacy, manager-scope, auth suites;
                          # sibling agents added 2 test files / 32 tests
                          # during this review — all passing)
```

Manual checks performed (code read, not just grepped):
- `lib/auth/session.ts`, `csrf.ts`, `password.ts`, `tokens.ts`, `middleware.ts`
- `lib/permissions.ts` vs `docs/RBAC.md` matrix
- `lib/services/auth.ts` (login/lockout/enumeration), `invitations.ts`
  (token entropy/expiry/single-use), `admin.ts` (suspend → `revokeAllSessions`),
  `companies.ts` (company-post scoping in Prisma `where`)
- All `app/api/**/route.ts` use `handle()` (CSRF + rate limit); admin routes
  delegate to `assertAdmin` services; sensitive routes call the right
  `require*` helper
- `lib/realtime/server.ts` handshake (origin + session), room-join membership
  checks, event rate limits, zod-validated payloads
- Secret scan: `grep -rniE "(api[_-]?key|secret|password…)\s*[:=]\s*['\"][^'\"]{8,}"`
  over `app lib components server.ts prisma/seed.ts scripts` (excluding
  node_modules/.next) → only demo seed passwords
- `dangerouslySetInnerHTML` → only static theme script; `javascript:` URLs → none
- `.env` gitignored, `.env.example` placeholder-only

**Verified in a live browser (2026-10-03):** rendered CSP behavior at first paint
with the nonce, and a full hydration pass over the authenticated pages
(`/home`, `/admin/*`). One real violation was found and fixed — see R1.
**Still unverified:** socket.io handshake over the wire, file-upload round trip.
`CSP_MODE=report-only` remains the documented diagnostic step if any rendering
issue appears.

---

## 3. Residual risks

| # | Risk | Severity | Notes / recommendation |
|---|------|----------|------------------------|
| R1 | ~~**CSP is new and untested in a browser.**~~ **Exercised in a live browser (2026-10-03).** First paint with the nonce works, and a full hydration pass on the authenticated pages (`/home`, `/admin/*`) is clean. One real violation surfaced: React's **development** build calls `eval()` to reconstruct callstacks, which `script-src` blocked — every page load logged a Console Error. Fixed by adding `'unsafe-eval'` in **development only** (`proxy.ts` → `buildCsp`). | Low (resolved) | Production `script-src` deliberately omits `'unsafe-eval'` — React never calls `eval()` in production, so the protection is intact. Re-verify if the CSP is ever re-diagnosed via `CSP_MODE=report-only`. |
| R2 | **Sessions have no absolute lifetime cap.** Sliding refresh (30d, 5-min debounce) means an active session never expires. Per `ARCHITECTURE.md` §2.2 design. | Low | Consider an absolute cap (e.g. 90d `createdAt`-based) forcing re-login; also consider rotating the session token on privilege changes. |
| R3 | **In-memory rate limiter is per-instance.** Fine for the single-instance custom server; breaks down behind multiple replicas / restarts. | Low | Redis swap is documented in `lib/rate-limit.ts`; do it before horizontal scaling. Also note `getClientIp` trusts `x-forwarded-for` — only safe behind a trusted proxy that overwrites it. |
| R4 | **TURN credentials story is unfinished.** Static `NEXT_PUBLIC_TURN_*` creds would be world-visible; the vars are currently dormant (call UI not built). | Low (latent) | When building calls: mint ephemeral TURN credentials from an authenticated endpoint (TURN REST API: `username = expiry:userid`, `password = HMAC(secret, username)`); keep the shared secret server-side only. Flagged in `lib/webrtc/ice-config.ts`. |
| R5 | **Invitation accept has a TOCTOU race.** Status check happens outside the membership-creation transaction; two concurrent accepts → one fails on the `(companyId, userId)` unique constraint with a 500 instead of a graceful response. No duplicate membership possible. | Low | Move the status check + `ACCEPTED` marking into the transaction (conditional update on `status: "PENDING"`), or catch P2002 → return the existing membership. |
| R6 | **Socket.io CORS falls back to `origin: true` when neither `SOCKET_ALLOWED_ORIGINS` nor `APP_URL` is set** (dev convenience). The handshake origin check is likewise skipped then. | Low | Always set `APP_URL` (or `SOCKET_ALLOWED_ORIGINS`) in production; consider failing closed when unset and `NODE_ENV=production`. |
| R7 | **`/uploads/[...path]` is public and rate-limit-exempt** (documented v1 tradeoff; private kinds get auth-gating in v2). | Low | Auth-gate `message`/`voice` kinds before serving anything sensitive; add signed URLs for the S3 driver. |
| R8 | **Password policy is length-only (≥8).** zxcvbn check is documented as "warn, don't block" and not implemented. | Info | Add breach-corpus / complexity nudges client-side when the UX team is ready; server minimum is acceptable for v1. |
| R9 | **Demo credentials are public by design** (`Admin123!` etc. in `prisma/seed.ts` + console output). Guarded against production seeding (F5), but anyone with the repo knows them. | Info | Never run the seed against shared/prod data; rotate/remove demo accounts in any internet-exposed staging env. |

---

## 4. Files changed (this pass)

**Security fixes:**
- `lib/auth/password.ts` — `burnDummyPasswordCompare()` (F1)
- `lib/services/auth.ts` — dummy compare on unknown-email login (F1)
- `next.config.ts` — security headers (F2)
- `middleware.ts` — nonce CSP, extended matcher, `CSP_MODE` (F3)
- `lib/theme.tsx` — `ThemeScript({ nonce })` (F3)
- `app/layout.tsx` — reads `x-nonce`, passes to theme script (F3)
- `app/api/uploads/[...path]/route.ts` — `nosniff` (F4)
- `prisma/seed.ts` — production guard (F5)
- `lib/webrtc/ice-config.ts` — typing fix + TURN security note (F6)
- `.env.example` — `CSP_MODE` docs

**tsc acceptance fixes** (all minimal, no behavior change):
- `lib/chat.ts`, `lib/voice/recorder.ts`, `lib/realtime/client.tsx`
- `components/chat/ChatWindow.tsx`, `components/chat/MessagesView.tsx`,
  `components/chat/ChatComposer.tsx`, `components/companies/CompanyWorkspace.tsx`,
  `components/admin/AdminUsers.tsx`, `components/manage/ManageDashboard.tsx`,
  `components/notifications/NotificationCenter.tsx`,
  `components/posts/CommentThread.tsx`, `components/posts/PostComposer.tsx`,
  `components/posts/PostFeed.tsx`, `components/ui/form-field.tsx`,
  `components/layout/AppShell.tsx`
- `components/search/SearchBar.tsx` — created, then superseded by sibling's
  fuller version (kept theirs)
- `app/(app)/profile/[username]/page.tsx`, `app/(app)/settings/page.tsx` —
  `apiGet` params + `res` type annotation
- `docs/SECURITY_REVIEW.md` — this file
