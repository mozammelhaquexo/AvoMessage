# AvoMessage — QA Report (Phase 12, Agent 09)

**Date:** 2026-10-03 · **QA Engineer:** Agent 09
**Scope:** full vitest suite, coverage-gap tests, authorization-matrix re-verification,
HTTP smoke test, accessibility spot-check, responsive review, E2E strategy.

## 1. Test results

`npx vitest run` — **12 files, 147 tests, all green** (0 failed, 0 skipped).
`npx tsc --noEmit` — clean.

| File | Tests | Notes |
|---|---|---|
| `tests/api/messaging.test.ts` | 13 | **new** — conversations, DM dedupe, send/edit/delete, reactions, read, member scoping |
| `tests/api/posts-crud.test.ts` | 13 | **new** — post CRUD, threaded comments + depth cap, like/bookmark toggles, visibility |
| `tests/api/notifications.test.ts` | 9 | **new** — creation on like/comment/follow/mention, block/self suppression, mark-read |
| `tests/api/invitations.test.ts` | 7 | **new** — create/preview/accept, expiry, resend rotation, revoke, manager-only |
| `tests/api/uploads.test.ts` | 9 | **new** — MIME/extension/size allowlists, SVG rejection, magic-byte sniffing |
| `tests/api/auth.test.ts` | 13 | pre-existing |
| `tests/api/authz-matrix.test.ts` | 16 | pre-existing — authorization matrix |
| `tests/api/social.test.ts` | 10 | pre-existing |
| `tests/api/company-privacy.test.ts` | 9 | pre-existing — was **failing** on first run (see B1) |
| `tests/api/manager-scope.test.ts` | 16 | pre-existing — cross-company + admin-guard matrix |
| `tests/voice.test.ts` | 14 | pre-existing (unit) |
| `tests/call-machine.test.ts` | 18 | pre-existing (unit) |

Baseline before this phase: 96 tests / 7 files. **Added 51 tests / 5 files.**

Environment note: the VM had been replaced and PostgreSQL was gone. The
coordinator's `apt-get update` wedged on a slow mirror, so after the allotted
wait I provisioned PostgreSQL 16 locally from cached .debs, created role/db
(`avomessage` / `avomessage_dev`), ran `prisma migrate deploy` + `prisma db
seed`. Demo seed data is intact; all tests clean up after themselves
(`TestAgent.cleanup`, extended in this phase for conversations/messages/
invitations — see §5).

## 2. Bugs found and fixed

| # | Severity | Bug | Fix |
|---|---|---|---|
| B1 | **High** | `POST /api/companies/:id/posts` crashed with **500** on every company post (`TypeError: Cannot read properties of undefined (reading 'map')` in `serializePostWithViewerState`). `createCompanyPost` used `include: { author: true }`, so `post.media` was `undefined`. The existing `company-privacy` suite caught it. | `lib/services/companies.ts` — `createCompanyPost` now uses the standard `postFeedInclude` (author public-fields select + media), matching every other post query in the file. Also fixes an over-fetch (`author: true` pulled the full user row). |
| B2 | **Medium** | Deleted messages never appeared as tombstones in message history: `listMessages` filtered `deletedAt: null`, so the `messageTombstone` serializer branch and the frontend's `deleted: true` rendering (`MessageBubble`, `ConversationList` "Message deleted") were unreachable via REST. ARCHITECTURE.md §8 requires reads to return tombstones. | `lib/services/messages.ts` — removed the `deletedAt` filter from `listMessages`; `messageView()` now maps soft-deleted rows to tombstones. `toConversationView` intentionally keeps the filter for the conversation-list preview and unread counts (deleted messages don't count as unread). New test asserts the tombstone. |
| B3 | **Low** | `POST /api/conversations` returned **201** even when returning an existing DM pair; the documented contract (ARCHITECTURE.md §7, and the pattern already used by `POST …/messages` idempotency) is **200** for the deduped case. | Route now returns `200 { conversation, created: false }` on dedupe, `201` on create. The API client treats all 2xx as success; no frontend change needed. Covered by the DM-dedupe test. |
| B4 | **Low (a11y/UX)** | Chat composer emoji picker: the outside-click `ref` was on the popover only, not the toggle button — clicking the toggle while open closed-then-immediately-reopened the picker, so it could never be dismissed via its own button. Neither picker closed on Escape. | `components/chat/ChatComposer.tsx` — moved `ref` to the wrapper (toggle included); added Escape-to-close. `components/posts/PostComposer.tsx` — added Escape-to-close. |

No security/permission check was weakened for any of these; all fixes are
minimal and `tsc` is clean.

### Test-authoring corrections (not app bugs)

While writing the new tests I corrected my own wrong assumptions against the
implementation (documented here so the "expected" values are on record):
- Comment list is **threaded** — top-level with nested `replies`, not flat.
- Serialized post uses `author.id` / `counts.likes`, not `authorId`/`likeCount`.
- Comment depth overflow → `403 MAX_DEPTH` (not 400).
- Deleted post GET → `410 Gone` (deliberate, like invitations); revoked
  invitation token → `410`, rotated (resent) token → `404`.
- `POST …/members` → `201`; PATCH conversation returns the view unwrapped.
- Notification list serializes `actor: {...}`, not `actorId`.
- `repost()` copies body + bumps `shareCount`; there is no `repostedFromId`
  column in v1 (product observation, §6).

## 3. Authorization matrix — re-verified

Re-ran the full matrix suites green (`authz-matrix` 16, `company-privacy` 9,
`manager-scope` 16). Explicit coverage of the three required checks:

- **(a) Company-private posts unreachable by non-members incl. direct API GET:**
  `company-privacy.test.ts` — "non-member cannot reach a company post by
  direct id GET → 403/404", "non-member cannot list or post to the company
  feed", "member CAN reach the same post by direct id GET" (positive control).
- **(b) Cross-company manager blocked:** `manager-scope.test.ts` — "owner of
  company A cannot touch company B": member management, patch/delete company,
  invitations all → 403/404; positive control that the same owner CAN manage
  their own company.
- **(c) Non-admin blocked from `/api/admin/*`:** `manager-scope.test.ts` —
  "admin routes: normal user gets 403 on all /api/admin/*" (every admin route)
  plus unauthenticated → 401.

## 4. Smoke test (HTTP, curl + cookie jars)

Script: `scripts/qa-smoke.sh` (self-cleaning — removes its users and dependent
rows afterwards). Run against `npm run dev` (`tsx server.ts`) on port 3100.

**Result: 21/21 passed.**

Flow covered: signup A → verify-email (token from LogMailer) → login →
create post → comment → signup/verify/login B → B likes A's post → B follows
A → A sees `LIKE` + `FOLLOW` notifications (`unreadCount` > 0) → A creates DM
with B → A sends message → B lists messages (sees it) → B marks read → B
reacts 👍 → A marks all notifications read → `unreadCount` = 0.

Evidence: all steps returned the expected status codes (201/200); notification
payloads contained the expected types; the reaction round-tripped.

## 5. Test-helper change

`tests/helpers.ts` — `TestAgent.cleanup()` extended (same best-effort pattern)
to delete conversations, messages, reactions, attachments, voice messages,
call participants/calls, and invitations/teams for tracked users, in
dependency order. Required because `Message.senderId` is `SetNull` (messages
survive user deletion) and there is no cascade from User to conversations.

## 6. Accessibility spot-check (code review)

**Passing:** skip link → `#main-content`; single `<main>` landmark per page;
labelled navs (`Main`, `Mobile navigation`, `Admin sections`, `Pagination`);
`role="log"` message history with `aria-label`; icon buttons all labelled;
`FormField` associates labels via `htmlFor` + `useId`, errors announced with
`role="alert"`; dialogs have focus trap + Escape + `aria-modal`; `DataTable`
uses real `<table>` with `<caption>`, `scope="col"`, `aria-sort`, and a mobile
`role="list"` fallback; touch targets ≥ 44px (`min-h-11`); loading skeletons
correctly `aria-hidden` (no focusable children).

**Fixed in this phase:** B4 (emoji picker toggle/Escape).

**Open (minor, filed not fixed):** the emoji popovers use `role="dialog"`
without focus trapping — acceptable for a non-modal popover, but focus is not
moved into the picker when it opens. Recommend `aria-modal="false"` semantics
stay as-is and revisit if the picker gains keyboard navigation.

## 7. Responsive review (CSS reasoning)

- **320px:** sidebar hidden (`hidden lg:flex`), mobile bottom tab bar
  (`lg:hidden`) with `pb-[env(safe-area-inset-bottom)]`; content has `pb-24`
  clearance; chat shows list *or* detail (never squeezed side-by-side).
- **768px:** messages switch to list (`md:w-80`) + detail split;
  `DataTable` switches from card list to real table at `md`.
- **1440px:** sidebar (`w-72` + `lg:pl-72`), right rail (`hidden xl:flex`).
- No fixed pixel widths on critical containers; grids use `sm:`/`md:`
  breakpoints throughout. No issues found.

## 8. E2E (Playwright)

Deferred — no live browser in this environment. Strategy written to
`docs/E2E_PLAN.md`: P0/P1/P2 matrix, Playwright fixtures (DB snapshot restore,
mail stub), accessible selectors, WebRTC fake-device plan for call tests, and
acceptance criteria. The curl smoke script (§4) is the manual checklist to
port first.

## 9. Post-run incident: seed DM deleted by an external session

After the final green suite run, the seed DM conversation (demo ↔ jules) was
found deleted. Audit log: `conversation.delete` at 2026-10-02T19:34:52Z by
`demo@avomessage.demo` from 127.0.0.1 — i.e. an interactive/coordinator
session using the demo login, **not** this phase's tests (all test users are
`@example.com`, none call the conversation-delete route, and the helper
cleanup uses raw Prisma with no audit trail). The DM was restored surgically
to the seed definition (2 members, 5 text + 1 voice message, jules' reaction,
read states). Seed state verified afterwards: 5 users, 2 companies,
2 conversations. (Post count is 9 vs the seeded 8 because the coordinator's
own smoke test added a post — left untouched.)

## 10. Remaining risks

1. **R5 (from SECURITY_REVIEW) still open:** invitation-accept TOCTOU race —
   concurrent accepts fail with 500 on the unique constraint instead of a
   graceful response. Low severity; unchanged by this phase.
2. **`DELETE /api/posts/:id/like` (unlike) doesn't require verified email**
   while the POST toggle does. Minor inconsistency; unlike is not content
   creation, but the asymmetry looks unintentional — recommend aligning.
3. **Reposts have no attribution link** to the original (no `repostedFromId`
   column); the copy is indistinguishable from an original post. Product
   decision needed before it matters for moderation.
4. **Doc drift:** ARCHITECTURE.md documents `GET /api/feed?type=…` but the
   route is `GET /api/posts` (and ignores `type`); invitation routes live at
   `/api/invitations` not `/api/companies/:id/invitations`. Recommend a doc
   sync pass.
5. **In-memory singletons** (message `clientId` dedupe cache, rate limiter)
   don't survive restarts / don't span instances — documented in the security
   review (R3); the DB unique constraint on `(conversationId, clientId)` is
   the real backstop.
6. **E2E gap:** no browser-driven tests exist yet (see §8); the API suite
   covers rules, not the UI→API→realtime wiring.
