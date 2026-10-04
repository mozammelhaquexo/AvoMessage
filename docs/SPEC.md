# AvoMessage — Feature Specification (SPEC)

> **Status:** Phase 0–1 (Discovery + Architecture). This is the buildable breakdown of the product.
> **Note on source:** `SPEC_SOURCE.md` was not present in the working directory when this was written.
> This spec is derived from the task brief's enumerated scope (user journeys signup→verify→home→post→message→company→manager→admin,
> plus the full entity list). Treat any gap vs. a future SPEC_SOURCE.md as an open question — see `docs/SPEC.md §13`.

## Build phases

| Phase | Name | Core deliverable |
|---|---|---|
| 0–1 | Discovery + Architecture | This doc set + Prisma schema |
| 2 | Foundation & Auth | DB migrations, mailer/storage abstractions, full auth lifecycle |
| 3 | Profiles & Social Graph | Profiles, follow/block/mute, search, hashtags, mentions |
| 4 | Posts & Feed | Composer, posts CRUD, comments, likes, bookmarks, home/explore feeds |
| 5 | Messaging (core) | Conversations, messages REST API, attachments, voice messages |
| 6 | Realtime layer | Socket.io server, presence, typing, delivered/read receipts |
| 7 | Voice & Video calls | WebRTC P2P + signaling, call history |
| 8 | Notifications | Notification engine (in-app + push-ready) |
| 9 | Companies & Teams | Workspaces, members, teams, invitations |
| 10 | Manager console | Company management UI + APIs |
| 11 | Admin & Moderation | Reports queue, user admin, settings, audit logs |
| 12 | Media & Storage | Upload pipeline, image variants, validation |
| 13 | Hardening & Launch | Rate limits, CSRF, security headers, perf, docs |

**Phase dependencies:** 3→4→5→6→7 is the critical chain. 8 depends on 6. 9 depends on 2. 10 depends on 9. 11 depends on 2. 12 can run parallel with 5–9. 13 is last.

---

## User journeys

### J1. Signup → Verify → Home
1. Visitor opens `/register`, submits name, username, email, password.
2. Server validates (zod), checks email/username uniqueness, hashes password (bcrypt, cost 12), creates user (unverified), sends verification email (log driver in dev).
3. User clicks link → `/verify-email?token=…` → token verified (hashed, single-use, 24h expiry) → `emailVerifiedAt` set → session created → redirect `/home`.
4. Unverified users can log in but see a persistent banner; posting/messaging are blocked until verified.

**Acceptance:** registration rejects duplicate email/username with field-level errors; verification link expires after 24h and is single-use; unverified user attempting to post receives 403 with `EMAIL_UNVERIFIED`.

### J2. Post → Engage
1. From `/home`, user opens composer, writes text (≤2000 chars), attaches up to 4 images, picks visibility (Public/Followers/Private).
2. Post appears in own feed; followers receive `feed:post:new` over Socket.io and a notification (if enabled).
3. Another user likes, comments (threaded 1 level), bookmarks. Counters update optimistically, confirmed by server.
4. Author can edit (within no limit, marked edited) or delete (soft delete). Comments/replies likewise.

**Acceptance:** feed paginates (cursor); deleted posts return 404/410 and vanish from feeds; like is idempotent (toggle).

### J3. Message → Call
1. From a profile, user clicks "Message" → DM conversation created (or reused) → `/messages/[id]`.
2. Typing indicators, presence (online/away/offline), delivered/read receipts via Socket.io rooms.
3. User sends image attachment, voice message (≤5 min, waveform rendered), emoji reaction.
4. User starts video call → callee gets `call:incoming` + notification → P2P WebRTC with STUN/TURN → call record + participant rows written.

**Acceptance:** messages persist and reload with cursor pagination; receipts transition sent→delivered→read; missed call creates notification + call record with status MISSED.

### J4. Company → Manager
1. User creates company (`/companies/new`) → becomes OWNER → invites teammates by email (`/invite/[token]` link, 7-day expiry, role preselected).
2. Invitee registers (or logs in) → auto-joins company with invited role → lands on company workspace.
3. Owner creates teams, assigns managers; manager views `/manage/[slug]` — members, teams, activity, pending invitations; can change member roles, remove members, revoke invites.
4. Company posts (visibility COMPANY) appear in the company feed; company group chats exist.

**Acceptance:** invite token is single-use and expires; non-members get 403 on company routes; OWNER cannot be demoted by a MANAGER; last OWNER cannot leave.

### J5. Admin
1. Admin opens `/admin` → stats (users, posts, messages, reports pending), user table (search, suspend/unsuspend, role change), reports queue (review → action: dismiss / delete content / suspend user), audit log of all actions, system settings (registration toggle, upload limits).
2. Every admin action writes an `AuditLog` row with actor, IP, metadata.

**Acceptance:** non-admin gets 403 on all `/api/admin/*` and `/admin/*`; suspending a user revokes their sessions immediately.

---

## Features by phase

### Phase 2 — Foundation & Auth
- **F2.1 Registration:** `POST /api/auth/register` — zod validation (email, username 3–20 `[a-z0-9_]`, password ≥8 with complexity hint), uniqueness checks, bcrypt(12), create user + verification token + verification email. Rate limit 5/hr/IP.
- **F2.2 Email verification:** `POST /api/auth/verify-email` — constant-time token compare, single-use, 24h expiry, resend endpoint (cooldown 60s).
- **F2.3 Login/logout:** `POST /api/auth/login` (email+password; rejects unverified with specific code, suspended with specific code), `POST /api/auth/logout`. Login activity recorded (success/failure, IP, UA).
- **F2.4 Sessions:** DB-backed sessions, signed httpOnly cookie (`avo_session`), 30-day sliding expiry, `GET /api/auth/session`, per-device list + revoke one / revoke others.
- **F2.5 Password reset:** forgot → emailed token (1h, single-use) → reset. Invalidates all sessions on success.
- **F2.6 Mailer abstraction:** `Mailer` interface; `LogMailer` (dev), `ResendMailer`/`SmtpMailer` (prod, env-selected). Templates: verify, reset, invite.
- **F2.7 Storage abstraction:** `StorageDriver` interface; `LocalDriver` (dev, `./storage/uploads`), `S3Driver` (prod, S3-compatible). Validation rules (see Architecture §6).
- **Acceptance:** all auth routes rate-limited; passwords never logged; session cookie `HttpOnly; Secure; SameSite=Lax; Path=/`.

### Phase 3 — Profiles & Social Graph
- **F3.1 Profiles:** `GET/PATCH /api/users/me`, `GET /api/users/:username`; avatar/cover upload; bio 280 chars; private-account flag.
- **F3.2 Follow system:** follow/unfollow; private accounts → follow requests (v1: auto-approve? **Decision:** v1 private accounts require approval — `Follow` gains `status` PENDING/ACCEPTED in implementation; schema `Follow` extended then).
- **F3.3 Block/mute:** block hides both directions (messages, posts, profile); mute hides from feeds only.
- **F3.4 Search:** `GET /api/search?q=&type=users|posts|hashtags|companies`; trigram/ILIKE v1, paginated.
- **F3.5 Hashtags & mentions:** `#tag` parsed on post/comment create → `Hashtag`/`PostHashtag`/`Mention` rows; trending hashtags endpoint.
- **Acceptance:** blocked users' content never appears in feeds/search/DM suggestions; mention creates notification.

### Phase 4 — Posts & Feed
- **F4.1 Composer + CRUD:** create (text + ≤4 media + visibility), edit body/visibility, soft delete. Server trims, linkifies, parses hashtags/mentions transactionally.
- **F4.2 Comments:** threaded (1 level), edit/delete own, delete-any by post author; `commentCount` maintained.
- **F4.3 Likes & bookmarks:** idempotent toggles; like lists; bookmark collection page.
- **F4.4 Feeds:** `/home` = followed + own posts (chronological v1, "For you" ranked v2 — document as future); `/explore` = public trending; company feed = COMPANY posts. Cursor pagination, visibility filtering server-side.
- **Acceptance:** feed never leaks PRIVATE/FOLLOWERS/COMPANY posts to unauthorized viewers; N+1-free (include author, media, counts, viewer-state in one query).

### Phase 5 — Messaging (core)
- **F5.1 Conversations:** DM (unique pair enforced) + groups (title, avatar, roles OWNER/ADMIN/MEMBER); create, rename, add/remove members, leave.
- **F5.2 Messages:** send text (≤4000), edit (15-min window, marked), soft delete (own; admin override); cursor history.
- **F5.3 Attachments:** image/video/file via upload pipeline; size/type validation; rendered inline.
- **F5.4 Voice messages:** record in client → upload → `VoiceMessage` row (duration, waveform JSON) → player UI.
- **F5.5 Reactions:** emoji reactions, toggle, aggregated counts.
- **F5.6 Read state:** `lastReadAt` per member; unread counts on conversation list.
- **Acceptance:** non-members get 403 on conversation endpoints; blocked users cannot DM each other; message order stable under concurrent sends (DB `createdAt` + id tiebreak).

### Phase 6 — Realtime layer
- **F6.1 Socket.io custom server** (`server.ts` wrapping Next): auth via session cookie on handshake; rooms `user:{id}`, `conversation:{id}`, `company:{id}`, `call:{id}`.
- **F6.2 Presence:** heartbeat → `presence:update` broadcast to relevant rooms; `UserPresence` persisted (debounced).
- **F6.3 Typing indicators:** `typing:start/stop` → `typing:update` in `conversation:{id}` (excluding sender), 5s auto-expire.
- **F6.4 Receipts:** `message:delivered` / `message:read` events; server updates `lastReadAt`; broadcasts to `conversation:{id}`.
- **F6.5 Feed fan-out:** `feed:post:new` to followers' `user:{id}` rooms; `notification:new` likewise.
- **Acceptance:** socket disconnect → presence OFFLINE after 60s grace; reconnect resumes rooms; no event emitted to unauthorized rooms (membership checked on join).

### Phase 7 — Voice & Video calls
- **F7.1 Signaling:** `call:signal` relay (offer/answer/ice-candidate) in `call:{id}` room; server validates participation, never stores SDP.
- **F7.2 Call lifecycle:** initiate → RINGING → ONGOING → ENDED; decline/missed/failed transitions; `call:incoming` to callee `user:{id}` rooms.
- **F7.3 P2P media:** WebRTC `RTCPeerConnection`; STUN default + TURN from env; client handles renegotiation.
- **F7.4 History:** `Call` + `CallParticipant` rows; missed calls → notification; call summary system message in conversation.
- **Acceptance:** signaling rejected for non-participants; call ends cleanly on either side hangup; no media traverses our servers (except TURN relay when needed).

### Phase 8 — Notifications
- **F8.1 Engine:** `notify()` service — creates `Notification` row + emits `notification:new` to `user:{id}`; dedupes (e.g. multiple likes → one row, counter in body); respects mutes/blocks and per-type user prefs (v1: global on/off per type stored in `SystemSetting`-adjacent user prefs JSON on User — implement as `notificationPrefs Json` field added in this phase).
- **F8.2 Types:** LIKE, COMMENT, FOLLOW, MENTION, MESSAGE (only when conversation muted? no — for new conversations / when tab inactive), CALL_MISSED, INVITATION_*, COMPANY_ROLE_CHANGED, TEAM_ADDED, REPORT_STATUS, SYSTEM.
- **F8.3 UI:** bell with unread count, list, mark-read (single + all).
- **Acceptance:** no notification to blocked/muted actors; marking read syncs across tabs via socket.

### Phase 9 — Companies & Teams
- **F9.1 Companies:** create (name, slug), edit, logo/cover; owner = creator; deactivate (admin).
- **F9.2 Membership & roles:** OWNER/MANAGER/MEMBER; role change rules (only OWNER↔OWNER, MANAGER+ can manage MEMBERs); remove member; leave (not last OWNER).
- **F9.3 Teams:** CRUD within company; add/remove members (must be company members); team MANAGER role.
- **F9.4 Invitations:** email invite with token link (7-day, single-use, role preselected); accept flow for new + existing users; revoke/expire; resend.
- **F9.5 Company feed & chats:** COMPANY-visibility posts; company group conversations.
- **Acceptance:** invite acceptance by a different email than invited → 403; expired invite → clear error + resend option for managers.

### Phase 10 — Manager console
- **F10.1 Dashboard:** `/manage/[slug]` — member list (search, role filter), pending invitations, teams overview, recent activity (audit-scoped).
- **F10.2 Member management:** change roles, remove, invite — all via existing company APIs; UI only.
- **F10.3 Team management:** create/edit teams, assign members + team managers.
- **F10.4 Company settings:** profile, slug (with redirect note), danger zone (transfer ownership, deactivate — owner only, confirm).
- **Acceptance:** every manager action permission-checked server-side; role changes write audit logs.

### Phase 11 — Admin & Moderation
- **F11.1 Reports:** users report posts/comments/messages/users (reason enum + details); queue with filters; actions: dismiss, delete content, suspend user, ban; reporter notified of outcome (`REPORT_STATUS`).
- **F11.2 User admin:** search, view (profile + activity + login history), suspend/unsuspend (revokes sessions), change platform role (SUPER_ADMIN only for ADMIN changes), verify badge toggle.
- **F11.3 System settings:** key/value store (`registration.enabled`, `uploads.max_mb`, `invite.expiry_days`, `feed.page_size`); cached in memory with 60s TTL.
- **F11.4 Audit log:** immutable table UI, filter by actor/action/date; export CSV (admin).
- **F11.5 Stats:** counts + time series for dashboard cards.
- **Acceptance:** SUPER_ADMIN is the only role that can create/demote ADMINs; settings changes take effect without restart.

### Phase 12 — Media & Storage
- **F12.1 Upload pipeline:** `POST /api/uploads` (multipart) → validate → store via driver → DB row (`Attachment`/`PostMedia`/avatar) → return URL. Direct-to-S3 multipart for prod (v2; v1 proxies through server with 100MB cap).
- **F12.2 Image variants:** thumbnails (256/1024) generated on upload (sharp); stored alongside originals.
- **F12.3 Validation:** MIME allowlists, magic-byte sniffing, size caps, filename sanitization, AV-scan hook point (interface, no-op v1).
- **Acceptance:** invalid MIME rejected with 422; uploads attributed to uploader; orphaned uploads garbage-collected (nightly job, v2 — document).

### Phase 13 — Hardening & Launch
- **F13.1 Rate limiting:** per-route buckets (auth strict, writes moderate, reads lenient) via Redis-less in-memory (single instance) with documented Redis swap point.
- **F13.2 CSRF:** double-submit cookie for cookie-authed mutations; same-origin check on socket handshake.
- **F13.3 Security headers:** CSP, HSTS, X-Frame-Options, etc. via `next.config.ts` headers.
- **F13.4 Perf:** feed query budgets, indexes verified with EXPLAIN, socket backpressure notes.
- **F13.5 Docs & runbooks:** env var reference, deploy checklist, backup/restore notes.
- **Acceptance:** `npm run build` clean, no TS errors, security checklist signed off.

---

## Cross-cutting acceptance criteria (all phases)

1. **Server-side authz:** every route helper-enforced (`requireSession`, `requireRole`, `requireCompanyMember`, `requireCompanyManager`, `requireAdmin`) — never frontend-only.
2. **Validation:** zod schemas at the API boundary; error shape `{ error: { code, message, fields? } }`.
3. **Pagination:** cursor-based everywhere lists can grow (`?cursor=&limit=` → `{ data, nextCursor }`).
4. **Soft delete:** posts/comments/messages keep rows with `deletedAt`; content replaced with tombstone in reads.
5. **Idempotency:** like/bookmark/reaction/follow toggles and invite-accept are safe to retry.
6. **Audit:** role changes, suspensions, settings changes, invite revocations → `AuditLog`.
7. **No N+1:** list endpoints batch relations; verified in review.

## Out of scope (v1)

Stories/Reels, algorithmic "For you" ranking, E2E encryption, message search full-text (basic ILIKE only), multi-device call handoff, SSO/SAML, mobile apps, i18n (English only), payment/billing.
