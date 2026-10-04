# AvoMessage — E2E Test Plan (deferred)

**Status:** deferred from Phase 12 QA. The full API/integration suite
(`npx vitest run`) is green and covers the authorization matrix, social graph,
messaging, notifications, posts/comments, invitations, and upload validation.
Browser-driven end-to-end tests were not run in this phase (no live browser in
the QA environment). This document is the strategy for adding them.

## 1. Why Playwright, when

Add Playwright E2E when a live browser is available in CI/dev. Suggested
trigger: the first release-candidate cut, or when the call UI (WebRTC) lands —
that flow cannot be covered any other way.

## 2. Test matrix

### P0 — critical paths (must pass before any release)

| # | Flow | Entry | Assertions |
|---|---|---|---|
| E1 | Signup → verify → login → home | `/register` | verification banner shows; after verify link, banner gone; `/home` renders feed |
| E2 | Create post (text + image) → like → comment → bookmark | `/home` | post appears at top of feed; like count increments; comment renders threaded; bookmark in `/bookmarks` |
| E3 | Follow → profile viewerState → unfollow | `/u/:username` | follower counts update; FOLLOW notification bell badge increments |
| E4 | DM: new conversation → send → read receipt → reaction | `/messages` | message appears for both users (two browser contexts); unread badge clears on open; reaction aggregates |
| E5 | Company: create → invite (mail link) → accept → post to company feed → non-member blocked | `/manage` | invite email link `/invite/:token`; company feed visible to member, 403 for non-member (incl. direct GET) |
| E6 | Admin: suspend user → user logged out; report queue → resolve | `/admin` | suspended user session revoked (403 on next action); audit log row written |

### P1 — important

| # | Flow | Notes |
|---|---|---|
| E7 | Password reset flow | forgot → mail link → reset → all sessions revoked |
| E8 | Comment depth cap + comment delete by post author | mirrors API tests at UI level |
| E9 | Message edit within 15 min; edit expired shows error | |
| E10 | Upload validation errors (SVG, oversize) | assert client-side pre-checks + server errors |
| E11 | Invitation expiry → resend → accept with fresh token | |
| E12 | Group chat: create, add/remove member, member removal revokes access | |

### P2 — nice to have

- E13: Voice message record → playback (needs mic permission stub).
- E14: 1:1 audio call over WebRTC (needs fake media devices; see §5).
- E15: Dark/light theme toggle persists; no layout shift.
- E16: Mobile viewport (375px) smoke: bottom tab nav, chat list→detail.

## 3. Infrastructure

- **Runner:** Playwright + `@playwright/test`, Chromium (and WebKit spot-check).
- **Fixtures:** a `test` worker fixture that (a) resets the DB to a known
  seed (`npx prisma migrate reset --force` + seed, or a SQL snapshot restore —
  snapshot restore is ~10× faster), (b) exposes an `api` helper (Playwright
  `request`) for test setup (create users/companies via REST with the same
  cookie-jar conventions as `tests/helpers.ts`), (c) captures traces on
  failure (`trace: 'retain-on-failure'`).
- **Mail:** point `MAILER_DRIVER=log` in E2E and read tokens from
  `storage/mail/*` (same technique as `tests/api/invitations.test.ts`), or
  stub the mailer with an in-memory outbox via a test-only endpoint guarded
  by `E2E_MAIL_STUB=1` (never enabled in production).
- **Auth in tests:** prefer UI signup/login for P0 (it IS the flow under
  test); use the `request` fixture to shortcut setup for P1/P2 (e.g. create
  a verified user, then `page` logs in by cookie injection).
- **Isolation:** each test file gets a fresh DB snapshot; never share users
  across tests (mirrors the `uniqueUser` convention).
- **Speed:** run P0 on every PR; P1 nightly; P2 pre-release.

## 4. Selectors

Prefer accessible selectors (`getByRole`, `getByLabel`) — they double as an
a11y check. `data-testid` only where accessible queries are impractical
(message bubbles, feed cards). Current component code already exposes:
skip link, `main#main-content`, labelled navs (`aria-label="Main"`,
`"Mobile navigation"`), `role="log"` message history, labelled dialogs —
these are stable anchors.

## 5. WebRTC / calls (E14)

- Launch Chromium with `--use-fake-device-for-media-stream
  --use-fake-ui-for-media-stream` and `--autoplay-policy=no-user-gesture-required`.
- Two browser contexts, both logged in, 1:1 call: assert `call:incoming`
  toast on callee, accept → `RTCPeerConnection` reaches `connected` (poll
  `page.evaluate` on the client's connection state), end → `call:ended`
  received by both. Group mesh (≤6) deferred to P2.
- Requires a reachable STUN server in the test env (default
  `stun:stun.l.google.com:19302`) or a local coturn; document which in CI.

## 6. What NOT to E2E-test

Logic already covered by vitest: permission matrix (403/404s), validation
rules, notification preference filtering, idempotency, upload allowlists.
E2E tests the wiring (UI → API → DB → realtime), not the rules.

## 7. Acceptance for "E2E done"

- P0 suite green on Chromium in CI, flake rate < 1% over 50 runs.
- Traces retained for failures; DB snapshot restore keeps full suite < 10 min.
- The smoke script from Phase 12 (`docs/QA_REPORT.md` §4) is ported to E1–E5
  so the manual checklist stops being manual.
