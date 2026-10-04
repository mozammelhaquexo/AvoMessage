# AvoMessage — Code Review (Agent 11)

**Date:** 2026-10-03 · **Reviewer:** Code Review Agent (build agent 11)
**Scope:** full codebase — duplication, security re-verification, permissions
tracing, architecture, unfinished flows, frontend/backend contracts.
**Working tree:** `~/workspace/avomessage`

**Bottom line:** the codebase was in good shape (agent 07's security pass had
already landed the hard security work). This pass fixed 2 high-severity issues
(duplicate API client, company-feed contract mismatch that silently dropped
media), split 3 giant components, removed dead shims, and kept `tsc` clean.
No permission checks were weakened; several over-broad Prisma includes were
tightened. DB-backed test suites could not run because the coordinator is
re-provisioning the DB — that is environmental, not a code failure; the
non-DB suites are green (32/32).

> **Concurrency note:** sibling agents edited the tree in parallel (messaging
> tests, voice tests, frontend). Several `tsc` errors fixed below were their
> in-progress typos; the fixes are minimal and behavior-neutral. Re-run
> `tsc` + vitest at integration time.

---

## 1. Findings — fixed

### F1 — HIGH — Duplicate API clients (consolidated)
`lib/api-client.ts` (49 call sites, canonical: CSRF, `params` support,
`uploadFile`, `ApiError.isAuthError`, 204 handling) and `lib/http-client.ts`
(2 call sites, weaker: no `params`, no 204 handling, ad-hoc error fallback).
- `lib/voice/upload.ts` → now uses `apiUpload` from `@/lib/api-client`.
- `lib/webrtc/calls-api.ts` → now imports from `@/lib/api-client`;
  `fetchCallHistory` uses `apiGet(..., { params })` instead of hand-built
  query strings.
- **Deleted** `lib/http-client.ts` (no remaining references).

### F2 — HIGH — Company feed contract mismatch (fixed properly, shims deleted)
`GET/POST /api/companies/:id/posts` and `/announcements` returned the minimal
`PostSummary` (`lib/types.ts`), while every other post endpoint returns the
canonical post shape. The frontend bridged the gap with `adaptPostSummary()`
(`components/posts/PostCard.tsx`), which **fabricated** `media: []`
(company posts with media rendered with no media), `shares: 0`, and
`updatedAt = createdAt` — plus a reverse shim `postToSummary()` in
`CompanyWorkspace.tsx` (`Post → PostSummary → Post` round-trip).
- `lib/services/posts.ts`: exported `PostWithIncludes` and the shared
  `postFeedInclude`; added `serializePostWithViewerState(post, viewerState)`
  (sync; `serializePost` reuses it). No N+1 regression — company endpoints
  keep their batched like/bookmark queries.
- `lib/services/companies.ts`: `listCompanyPosts`, `listAnnouncements`,
  `createAnnouncement`, `createCompanyPost` now return the canonical
  `SerializedPost`. `listAnnouncements` also gained batched viewerState
  (was hardcoded `{ liked: false, bookmarked: false }`).
- **Security tightening in the same edit:** all four functions used
  `include: { author: true }`, loading full user rows (incl. `passwordHash`)
  into memory on every company-feed read. Now `include: postFeedInclude`
  (public author fields + ordered media).
- `components/companies/CompanyWorkspace.tsx` (+ new `tabs/`): uses `Post`
  directly; `postToSummary` deleted. `adaptPostSummary` deleted from
  `PostCard.tsx` (no remaining consumers; verified by grep).

### F3 — MEDIUM — Giant components split (no behavior change)
| File | Before | After |
|---|---|---|
| `components/companies/CompanyWorkspace.tsx` | 852 | 170 (shell) + 9 tab files in `components/companies/tabs/` (42–179 lines each) |
| `components/chat/ChatWindow.tsx` | 721 | 574; `ConversationMemberManager` → `components/chat/ConversationMemberManager.tsx` (170) |
| `components/posts/PostComposer.tsx` | 650 | 151; `ComposerForm` → `components/posts/ComposerForm.tsx` (547, single cohesive form) |

### F4 — LOW — `Paginated<T>` vs `Page<T>` (unified)
Identical pagination shapes in `lib/types.ts` and `lib/api-types.ts`.
`Paginated<T>` is now `type Paginated<T> = Page<T>` — one definition, zero
call-site changes.

### F5 — LOW — `dist-server/` unignored
Compiled custom-server output was not in `.gitignore`; added `/dist-server/`.

### F6 — LOW — Media tab implemented
`CompanyMediaTab` was an honest placeholder ("no media endpoint to query").
Since F2 makes company posts return full `media`, the tab now renders a real
photo/video grid (limit 50).

### F7 — Sibling WIP `tsc` errors fixed (acceptance gate)
- `tests/api/messaging.test.ts`: two missing parens; `(t2.json as typeof
  reactions).reactions` → `(t2.json as { reactions: typeof reactions }).reactions`
  (×3 — `typeof reactions` was already the array type).
- `tests/api/posts-crud.test.ts`: missing paren.
- `tests/helpers.ts`: `initiatedById` → `initiatorId` (matches Prisma schema).

---

## 2. Verified — no change needed (security & permissions re-check)

- **Route envelope:** all 90 route handlers go through `handle()`
  (rate-limit → CSRF → typed `{ error: { code, message, fields? } }`
  envelope). Only pre-auth mutations opt out of CSRF (`csrf: false`:
  signup/login/verify-email/forgot/reset) — correct. The uploads-serve route
  hand-writes the envelope shape manually; consistent.
- **Admin routes:** `requireSession` in every handler + `assertAdmin()` inside
  every admin service (defense in depth; authorization-matrix tests cover
  non-admin 403s).
- **Scoping traced end-to-end:**
  - Notifications: `where: { id, userId }` on read/mark — users can't touch
    others' notifications (deep-links safe).
  - Calls: `requireParticipant` on get/transition; signaling relay is
    participant-checked in `lib/realtime/server.ts`.
  - Conversations: add-members requires `ADMIN`; room joins
    (`conversation:join`, `company:join`, `call:join`) re-check membership in
    socket handlers; `user:{id}` rooms are server-side only.
  - Companies: `requireCompanyMember` enforced in Prisma `where` for feeds;
    `updateMemberRole`/`removeMember` keep last-owner invariant and
    manager-cannot-touch-owner rules; invitation accept binds token → email
    match → single-use `ACCEPTED`.
  - Search: posts scoped by `worldFeedWhere` (COMPANY/PRIVATE structurally
    excluded); users exclude suspended/deleted; companies limited to own
    memberships. No message-type global search (see D6).
- **No secret leaks:** serializers build responses field-by-field or use
  explicit selects; `getOwnProfile` includes email only for self (correct);
  `publicUser` excludes email; invitation email is shown only to company
  managers (intended).
- **No unvalidated redirects** (`redirect()` only to static paths);
  **no** `dangerouslySetInnerHTML` with user content (theme script only);
  **no** `javascript:` URLs; `renderRichText` returns React nodes.
- **No dead buttons / fake flows:** zero `TODO`/`FIXME`/“coming soon” in
  `app`/`components`/`lib`; every button wires to a real handler.
- **Validators:** all zod schemas centralized in `lib/validation.ts`; none in
  components. Route handlers are thin (≤69 lines; parse → validate → service).
- **proxy.ts:** CSRF + nonce-CSP intact after the middleware→proxy migration.
- **`lib/server-session.ts`** is not a duplicate of `lib/permissions.ts` — it
  reuses the same verification path for Server Components (no `NextRequest`).

---

## 3. Deferred (with reasons)

| # | Item | Why deferred |
|---|---|---|
| D1 | DB-backed suites (auth, authz-matrix, company-privacy, manager-scope, social, messaging, posts-crud) not run | DB is being re-provisioned by the coordinator — environmental. Non-DB suites: **32/32 green**. Re-run full suite when the DB is back. |
| D2 | `timeAgo` (compact "5m") vs `formatRelative` ("5m ago") | Distinct display contracts; unifying changes user-visible copy. Accepted as-is. |
| D3 | `useAuth` / `useSession` both exported | Documented alias, intentional. |
| D4 | Minimal `PostSummary` retained for admin moderation tables | Deliberate dense-table contract (`admin.ts`, `AdminAnnouncements.tsx`), not a mismatch. |
| D5 | `/uploads/[...path]` public in v1 | Documented tradeoff (SECURITY_REVIEW R7); auth-gating private kinds is v2. |
| D6 | No global message search (`/api/search` covers users/posts/hashtags/companies) | In-thread search is client-side over member-scoped messages — secure; global message search is a spec "architecture" item, not a leak. |
| D7 | `lib/types.ts` vs `lib/api-types.ts` parallel universes (`PublicUser`, `SessionUser` differ subtly) | Full unification is a ~46-file refactor with shape differences; noted for a future pass. |

---

## 4. Verification

```bash
cd ~/workspace/avomessage
npx tsc --noEmit          # clean
npx vitest run tests/voice.test.ts tests/call-machine.test.ts  # 32/32 green
```

Design-system tokens respected throughout (no new hardcoded colors; new
files reuse `text-ink`, `bg-brand-soft/50`, `border-line-strong`, etc.).

## 5. Files changed (this pass)

**Deletions:** `lib/http-client.ts`.
**Backend:** `lib/services/posts.ts` (exported `PostWithIncludes`,
`postFeedInclude`, `serializePostWithViewerState`), `lib/services/companies.ts`
(canonical company-post shapes, tightened includes), `lib/types.ts`
(`Paginated` = `Page`).
**Frontend:** `lib/voice/upload.ts`, `lib/webrtc/calls-api.ts` (client
unification); `components/companies/CompanyWorkspace.tsx` (170-line shell) +
new `components/companies/tabs/*.tsx` (9 files); `components/chat/ChatWindow.tsx`
+ new `components/chat/ConversationMemberManager.tsx`;
`components/posts/PostComposer.tsx` + new `components/posts/ComposerForm.tsx`;
`components/posts/PostCard.tsx` (shim deleted).
**Tests (sibling WIP typos):** `tests/api/messaging.test.ts`,
`tests/api/posts-crud.test.ts`, `tests/helpers.ts`.
**Config/docs:** `.gitignore` (`/dist-server/`); `docs/CODE_REVIEW.md` (this file).
