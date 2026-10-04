# AvoMessage — Architecture (ARCHITECTURE)

> Phase 0–1. Single shared architecture for all build phases. Proven patterns only.

## 1. Stack decisions

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js App Router + TypeScript (strict) | SSR/SEO for public pages, colocated API routes, one deployable |
| Styling | Tailwind CSS (+ design tokens in `docs/DESIGN_TOKENS.md`) | Utility-first, token-driven theming incl. dark mode |
| Runtime server | Custom `server.ts` (Next + Socket.io on one HTTP server) | Realtime needs a long-lived socket server; App Router routes still serve HTTP |
| DB | PostgreSQL + Prisma | Relational data (feeds, graphs, memberships) with type-safe access |
| Auth | bcryptjs (cost 12) + DB sessions + signed httpOnly cookies | Revocable server-side sessions; no JWT foot-guns; works with sockets |
| Realtime | Socket.io (namespaces + rooms) | Presence/typing/receipts/call signaling; graceful fallback to polling |
| Calls | WebRTC P2P, Socket.io signaling, STUN + TURN via env | No media servers to operate in v1 |
| Storage | `StorageDriver` abstraction: local-disk (dev), S3-compatible (prod) | Swap by env, never by code change |
| Mail | `Mailer` abstraction: log driver (dev), Resend or SMTP (prod) | Templates shared; provider env-selected |
| Validation | zod at every API boundary + Prisma at DB | Single source of input truth per route |
| Errors | `{ error: { code, message, fields? } }` envelope, typed codes | Clients branch on `code`, not strings |

**Monorepo layout (single app):**
```
app/                    # App Router pages + route handlers
  (public)/             # marketing, login, register, invite accept
  (app)/                # authenticated: home, messages, profile, settings
  manage/[slug]/        # manager console
  admin/                # admin console
  api/...               # REST route handlers (thin → lib/services)
lib/
  auth/                 # session, password, tokens, csrf, permissions
  db.ts                 # Prisma client singleton
  mail/                 # Mailer interface + drivers + templates
  storage/              # StorageDriver interface + drivers
  services/             # domain logic (posts, conversations, notify, ...)
  realtime/             # socket server setup, room helpers, event catalog
  validation/           # zod schemas
server.ts               # custom server: Next + Socket.io
prisma/schema.prisma
```

**Rule: route handlers are thin.** They parse/validate → call a service → map errors. All business rules and permission checks live in `lib/services/*` and `lib/auth/permissions.ts`, so sockets, cron, and future workers reuse them.

## 2. Auth design

### 2.1 Passwords
- `bcryptjs`, **cost factor 12** (`BCRYPT_ROUNDS=12` env-overridable, never below 10).
- Password policy: ≥8 chars; zxcvbn score ≥2 recommended (warn, don't block, in v1). Never log, never return.

### 2.2 Sessions (DB-backed, no JWT)
- On login/verify: create `Session` row; generate 32-byte random token; store **SHA-256 hash** in `tokenHash`; set cookie `avo_session=<raw>.<sig>` where `sig = HMAC_SHA256(SESSION_SECRET, raw)`.
- Cookie: `HttpOnly; Secure (prod); SameSite=Lax; Path=/; Max-Age=30d`.
- On each request: split, verify HMAC (constant-time), hash raw, look up session → check `revokedAt`, `expiresAt` → sliding refresh (`expiresAt = now+30d`, `lastActiveAt=now`, debounced to 1 write/5 min per session).
- Socket.io handshake: same cookie parsed in `io.use()`; attach `socket.data.userId`.
- Logout: mark `revokedAt`, clear cookie. "Log out other devices": revoke all except current.

### 2.3 CSRF
- Double-submit: on session creation also set non-HttpOnly cookie `avo_csrf=<random>`; browser mutations must send header `x-csrf-token` equal to cookie value. Checked in middleware for `POST/PATCH/PUT/DELETE` on `/api/*` (except a few explicitly exempt: none in v1 — all cookie-authed mutations require it).
- Socket.io: origin check on handshake.

### 2.4 Verification & reset tokens
- 32-byte `crypto.randomBytes`, emailed as hex; **stored as SHA-256 hash** (`VerificationToken.tokenHash`, `Invitation.tokenHash`).
- Email verification: 24h expiry, single-use (`usedAt`), resend cooldown 60s.
- Password reset: 1h expiry, single-use; on success revoke **all** user sessions.
- Invitations: 7-day expiry (configurable), single-use; bound to invited email.

### 2.5 Login activity & lockout
- Every attempt → `LoginActivity` (success, IP, UA, reason). 5 failed logins / 15 min / account → temporary lock (15 min) + logged. 5 registrations / hr / IP.

## 3. Realtime — Socket.io on `server.ts`

Custom server: `server.ts` creates one HTTP server, attaches Socket.io, then delegates to Next's request handler. `npm run dev` / `start` run `tsx server.ts` (script: `"dev": "tsx server.ts"`).

### 3.1 Connection & rooms
- Auth in `io.use()`: verify session cookie → `socket.data.userId`, join `user:{id}` automatically.
- Client explicitly joins `conversation:{id}` / `company:{id}` / `call:{id}`; **server checks membership before joining** (DB lookup, cached 60s).
- On disconnect: mark presence OFFLINE after 60s grace (timer cancelled on reconnect).

### 3.2 Event catalog

**Client → server**

| Event | Payload | Server action |
|---|---|---|
| `presence:update` | `{ status: ONLINE\|AWAY\|DO_NOT_DISTURB }` | persist (debounced), broadcast `presence:update` to rooms of user's conversations + company |
| `typing:start` / `typing:stop` | `{ conversationId }` | broadcast `typing:update` to `conversation:{id}` minus sender; auto-expire 5s |
| `message:send` | `{ conversationId, body?, clientId, attachments? }` | validate membership, persist message, emit `message:new` to room, update `lastMessageAt`, notify offline/muted members |
| `message:delivered` | `{ messageId }` | mark delivered (per-recipient `MessageDelivery` — implement as JSON on message or join table in phase 6), emit to room |
| `message:read` | `{ conversationId, messageId }` | update member `lastReadAt`, emit `message:read` to room |
| `conversation:join` / `leave` | `{ conversationId }` | membership check → join/leave room |
| `call:signal` | `{ callId, to, kind: offer\|answer\|ice, payload }` | relay to `call:{id}` room participants only; never persisted |
| `call:join` / `call:leave` | `{ callId }` | membership check, update `CallParticipant`, broadcast participant events |

**Server → client**

| Event | Payload | Target |
|---|---|---|
| `presence:update` | `{ userId, status, lastSeenAt }` | rooms containing the user |
| `typing:update` | `{ conversationId, userId, isTyping }` | `conversation:{id}` |
| `message:new` | full message (author, attachments, voice) | `conversation:{id}` |
| `message:updated` / `message:deleted` | `{ messageId, ... }` | `conversation:{id}` |
| `message:delivered` | `{ messageId, userId }` | `conversation:{id}` |
| `message:read` | `{ conversationId, userId, lastReadAt }` | `conversation:{id}` |
| `notification:new` | notification object | `user:{id}` |
| `feed:post:new` | post summary | each follower's `user:{id}` |
| `conversation:updated` | `{ conversationId, lastMessageAt, unreadCount }` | members' `user:{id}` |
| `call:incoming` | `{ callId, from, type }` | callee `user:{id}` rooms |
| `call:signal` | `{ from, kind, payload }` | `call:{id}` |
| `call:ended` | `{ callId, reason }` | `call:{id}` + participants' `user:{id}` |
| `call:participant-joined/left` | `{ callId, userId }` | `call:{id}` |

**Reliability rules:** `message:send` is the only writer that must be idempotent — `clientId` (uuid per attempt) dedupes retries (`UNIQUE` on `(conversationId, clientId)` — add in phase 6 migration). REST `POST /api/conversations/:id/messages` remains the fallback path.

## 4. Storage abstraction

```ts
interface StorageDriver {
  put(key: string, data: Buffer | Stream, opts: { contentType: string; size: number }): Promise<{ url: string }>;
  delete(key: string): Promise<void>;
  getUrl(key: string): string; // public or signed URL
}
```
- **LocalDriver (dev):** writes under `./storage/uploads/<yyyy>/<mm>/<uuid>-<sanitized>`, served by `GET /uploads/[...path]` route (auth-gated for private kinds in v2; public in v1).
- **S3Driver (prod):** S3-compatible (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_PUBLIC_URL`).
- Key scheme: `<kind>/<yyyy>/<mm>/<uuid>-<sanitized-name>`, kinds: `avatars`, `covers`, `posts`, `messages`, `voice`, `company-logos`.

### Validation rules (enforced in `lib/storage/validate.ts`, before `put`)
| Kind | Max size | Allowed MIME |
|---|---|---|
| Avatar/cover/logo | 5 MB | image/jpeg, image/png, image/webp |
| Post media image | 10 MB | image/jpeg, image/png, image/webp, image/gif |
| Post/message video | 100 MB | video/mp4, video/webm |
| Message file | 25 MB | allowlist: pdf, doc(x), xls(x), ppt(x), txt, md, csv, zip |
| Voice message | 10 MB / 5 min | audio/webm, audio/mp4, audio/mpeg, audio/ogg |
- Magic-byte sniffing (first bytes vs. claimed MIME); filename sanitized; SVG never allowed as image (XSS).

## 5. WebRTC calls

- **Topology:** full-mesh P2P for 1:1; for groups v1 caps at 6 participants mesh (document SFU as v2 path).
- **Signaling:** Socket.io `call:signal` (offer/answer/ice-candidate); server relays only after participation check; SDP never persisted.
- **ICE:** `STUN_URL` default `stun:stun.l.google.com:19302`; `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` env (required for production reliability behind symmetric NAT).
- **Client:** `RTCPeerConnection` per peer in `lib/calls/peer.ts`; getUserMedia constraints by `CallType`; mute/camera toggles; reconnect on `iceconnectionstatechange=failed`.
- **Server record:** `Call` + `CallParticipant` rows written on initiate/join/leave/end — history and missed-call notifications derive from these, not from socket state.

## 6. Mailer abstraction

```ts
interface Mailer {
  send(opts: { to: string; subject: string; html: string; text: string; tag?: string }): Promise<void>;
}
```
- `LogMailer` (dev default): writes to console + `./storage/mail/<ts>-<tag>.html` for inspection.
- `ResendMailer` (`MAILER=resend`, `RESEND_API_KEY`) or `SmtpMailer` (`MAILER=smtp`, `SMTP_*`).
- Templates in `lib/mail/templates/*`: `verify-email`, `reset-password`, `company-invite`, `report-decision`. All include plain-text fallback. Base URL from `APP_URL`.

## 7. API contract

Base: `/api`. Auth: `🔒` = session cookie required (+ CSRF for mutations). `👑` = admin. Envelope: success → resource JSON; error → `{ error: { code, message, fields? } }`. Lists → `{ data: [...], nextCursor: string | null }` (cursor = opaque, `limit` default 20, max 100).

### Auth
| Method & path | Auth | Shape |
|---|---|---|
| `POST /api/auth/register` | – | `{name, username, email, password}` → `201 { user: PublicUser }` + sets session + csrf cookies |
| `POST /api/auth/verify-email` | – | `{ token }` → `{ ok: true }`; errors `TOKEN_INVALID/EXPIRED/USED` |
| `POST /api/auth/resend-verification` | 🔒 | `{}` → `{ ok: true }` (cooldown → 429) |
| `POST /api/auth/login` | – | `{ email, password }` → `{ user: PublicUser }` + cookies; errors `INVALID_CREDENTIALS`, `EMAIL_UNVERIFIED`, `ACCOUNT_SUSPENDED`, `ACCOUNT_LOCKED` |
| `POST /api/auth/logout` | 🔒 | → `{ ok: true }`, clears cookies |
| `GET /api/auth/session` | 🔒 | → `{ user: PublicUser, session: { id, createdAt, lastActiveAt } }` |
| `POST /api/auth/forgot-password` | – | `{ email }` → `{ ok: true }` always (no enumeration) |
| `POST /api/auth/reset-password` | – | `{ token, password }` → `{ ok: true }`, revokes all sessions |
| `GET /api/auth/sessions` | 🔒 | → `{ data: [{ id, ipAddress, userAgent, lastActiveAt, createdAt, current }] }` |
| `DELETE /api/auth/sessions/:id` | 🔒 | revoke one (not current via this route) |
| `DELETE /api/auth/sessions` | 🔒 | `{}` → revoke all others |
| `GET /api/auth/login-activity` | 🔒 | paginated own login attempts |

### Users & social graph
| Method & path | Auth | Shape |
|---|---|---|
| `GET /api/users/me` | 🔒 | full own profile incl. counts, prefs |
| `PATCH /api/users/me` | 🔒 | `{ name?, bio?, website?, location?, isPrivate?, avatarUrl?, coverUrl? }` |
| `GET /api/users/:username` | – | public profile + `viewerState { following, followedBy, blocked, muted }` (null when anon); private account → limited unless follower |
| `GET /api/search?q=&type=` | 🔒 | `type=users\|posts\|hashtags\|companies` |
| `POST /api/users/:id/follow` | 🔒 | → `{ following: true }`; idempotent |
| `DELETE /api/users/:id/follow` | 🔒 | → `{ following: false }` |
| `GET /api/users/:username/followers` / `/following` | 🔒 | paginated users |
| `POST /api/users/:id/block` / `DELETE ...` | 🔒 | toggle block |
| `POST /api/users/:id/mute` / `DELETE ...` | 🔒 | toggle mute |
| `GET /api/hashtags/trending` | – | `[{ tag, usageCount }]` (top 20, 7d weighted) |
| `GET /api/hashtags/:tag` | – | posts by tag (visibility-filtered) |

### Posts, comments, likes, bookmarks
| Method & path | Auth | Shape |
|---|---|---|
| `GET /api/feed?type=home\|explore` | 🔒(home)/–(explore) | posts + `author`, `media`, `counts`, `viewerState { liked, bookmarked }` |
| `GET /api/feed/company/:companyId` | 🔒+member | COMPANY posts |
| `POST /api/posts` | 🔒+verified | `{ body, visibility, companyId?, mediaIds? }` → `201 post` |
| `GET /api/posts/:id` | per visibility | full post |
| `PATCH /api/posts/:id` | 🔒 author | `{ body?, visibility? }` |
| `DELETE /api/posts/:id` | 🔒 author/manager/admin | soft delete |
| `POST /api/posts/:id/like` / `DELETE ...` | 🔒 | idempotent toggle → `{ liked, likeCount }` |
| `GET /api/posts/:id/comments` | per visibility | threaded, paginated |
| `POST /api/posts/:id/comments` | 🔒+verified | `{ body, parentId? }` → `201 comment` |
| `PATCH /api/comments/:id` | 🔒 author | `{ body }` |
| `DELETE /api/comments/:id` | 🔒 author/post-author/admin | soft delete |
| `POST /api/posts/:id/bookmark` / `DELETE ...` | 🔒 | toggle |
| `GET /api/users/me/bookmarks` | 🔒 | paginated posts |

### Conversations & messages
| Method & path | Auth | Shape |
|---|---|---|
| `GET /api/conversations` | 🔒 | `[{ id, type, title, members, lastMessage, unreadCount }]` ordered by `lastMessageAt` |
| `POST /api/conversations` | 🔒 | `{ type: DM\|GROUP, userIds?, title?, companyId? }` → `201`; DM with existing pair returns existing (200) |
| `GET /api/conversations/:id` | 🔒 member | conversation + members |
| `PATCH /api/conversations/:id` | 🔒 admin/owner | `{ title?, avatarUrl? }` |
| `POST /api/conversations/:id/members` | 🔒 admin/owner | `{ userIds }` |
| `DELETE /api/conversations/:id/members/:userId` | 🔒 admin/owner/self | remove / leave |
| `GET /api/conversations/:id/messages?cursor=` | 🔒 member | `{ data: [message+author+attachments+reactions+voice], nextCursor }` newest-first |
| `POST /api/conversations/:id/messages` | 🔒 member | `{ body?, type?, attachmentIds?, clientId }` → `201` (idempotent on `clientId`) |
| `PATCH /api/messages/:id` | 🔒 sender (15-min) | `{ body }` → edited |
| `DELETE /api/messages/:id` | 🔒 sender/admin | soft delete → tombstone |
| `POST /api/messages/:id/reactions` | 🔒 member | `{ emoji }` toggle → `{ reactions: [{emoji,count,reacted}] }` |
| `DELETE /api/messages/:id/reactions` | 🔒 member | `{ emoji }` remove |
| `POST /api/conversations/:id/read` | 🔒 member | `{ messageId? }` → updates `lastReadAt` |

### Calls
| Method & path | Auth | Shape |
|---|---|---|
| `POST /api/calls` | 🔒 | `{ conversationId?, userIds?, type: AUDIO\|VIDEO }` → `201 { call }`; emits `call:incoming` |
| `GET /api/calls/:id` | 🔒 participant | call + participants |
| `POST /api/calls/:id/accept` | 🔒 callee | → status ONGOING (first accept) |
| `POST /api/calls/:id/decline` | 🔒 callee | → DECLINED (or remove participant) |
| `POST /api/calls/:id/end` | 🔒 participant | → ENDED, `endedAt` |
| `GET /api/calls/history` | 🔒 | paginated own calls |

### Notifications
| Method & path | Auth | Shape |
|---|---|---|
| `GET /api/notifications` | 🔒 | paginated, `unreadCount` included |
| `POST /api/notifications/:id/read` | 🔒 | mark one |
| `POST /api/notifications/read` | 🔒 | `{ ids? }` — empty = mark all read |

### Companies, teams, invitations
| Method & path | Auth | Shape |
|---|---|---|
| `POST /api/companies` | 🔒 | `{ name, slug, description?, website? }` → creator becomes OWNER |
| `GET /api/companies` | 🔒 | own memberships `[{ company, role }]` |
| `GET /api/companies/:id` | 🔒 member (public summary if anon? no — 403) | company + `viewerRole` + counts |
| `PATCH /api/companies/:id` | 🔒 manager+ | `{ name?, description?, website?, logoUrl?, coverUrl? }` |
| `DELETE /api/companies/:id` | 🔒 owner | deactivate (soft) |
| `GET /api/companies/:id/members` | 🔒 member | paginated + roles |
| `PATCH /api/companies/:id/members/:userId` | 🔒 manager+ (rules) | `{ role }` → audit logged |
| `DELETE /api/companies/:id/members/:userId` | 🔒 manager+/self | remove / leave (not last OWNER) |
| `GET /api/companies/:id/activity` | 🔒 manager+ | audit-scoped feed |
| `POST /api/companies/:id/invitations` | 🔒 manager+ | `{ email, role?, teamId? }` → `201` + email sent |
| `GET /api/companies/:id/invitations` | 🔒 manager+ | pending list |
| `DELETE /api/invitations/:id` | 🔒 manager+ | revoke → audit |
| `POST /api/invitations/accept` | – (then 🔒) | `{ token }` → requires auth; email must match account email → creates membership |
| `GET /api/companies/:id/teams` | 🔒 member | teams + member counts |
| `POST /api/companies/:id/teams` | 🔒 manager+ | `{ name, description? }` |
| `GET /api/teams/:id` | 🔒 company member | team + members |
| `PATCH /api/teams/:id` | 🔒 manager+ | `{ name?, description? }` |
| `DELETE /api/teams/:id` | 🔒 manager+ | delete team (members keep company membership) |
| `POST /api/teams/:id/members` | 🔒 manager+ | `{ userId, role? }` (must be company member) |
| `DELETE /api/teams/:id/members/:userId` | 🔒 manager+/self | remove |

### Uploads & misc
| Method & path | Auth | Shape |
|---|---|---|
| `POST /api/uploads` | 🔒 | multipart `file`, `kind` → `201 { id, url, kind, mimeType, sizeBytes, width?, height? }` |
| `GET /api/reports` (user) | 🔒 | own filed reports |
| `POST /api/reports` | 🔒 | `{ targetType, targetId, reason, details? }` → `201` |

### Admin (`/api/admin/*`, all 👑)
| Method & path | Shape |
|---|---|
| `GET /api/admin/stats` | `{ users, posts, messages, companies, reportsPending, signups7d }` |
| `GET /api/admin/users?search=` | paginated users + status |
| `PATCH /api/admin/users/:id` | `{ isActive?, platformRole? (👑👑 super-admin only for ADMIN), isVerified? }` → suspend revokes sessions |
| `GET /api/admin/reports?status=` | queue with target snapshots |
| `PATCH /api/admin/reports/:id` | `{ status, action?: dismiss\|delete_content\|suspend_user }` → notifies reporter |
| `GET /api/admin/audit-logs` | filterable, paginated |
| `GET /api/admin/settings` / `PATCH /api/admin/settings` | `{ key, value }` upsert; audited |

## 8. Cross-cutting technical rules

1. **Authz helpers** (see `docs/RBAC.md`): `requireSession`, `requireVerified`, `requireRole`, `requireCompanyMember`, `requireCompanyManager`, `requireAdmin`. Route handlers call them first; services re-check on trusted boundaries (socket handlers).
2. **Transactions:** post create (post + media + hashtags + mentions + notifications), message send, invite accept, role change — all in Prisma `$transaction`.
3. **Counters:** `likeCount`, `commentCount`, `usageCount` updated in the same transaction as the triggering write.
4. **Soft delete:** queries always filter `deletedAt: null`; reads return tombstone `{ deleted: true }`.
5. **Pagination:** cursor = `createdAt:id` composite, base64url-encoded; stable under inserts.
6. **Rate limits (Phase 13):** auth 5–10/min, writes 60/min, reads 300/min, uploads 20/hr — in-memory token bucket, Redis swap documented.
7. **Env vars:** `DATABASE_URL`, `SESSION_SECRET` (≥32B), `APP_URL`, `BCRYPT_ROUNDS`, `MAILER` + provider keys, `STORAGE` + S3 keys, `STUN_URL`, `TURN_*`, `CSRF` handled via cookies. Full reference in Phase 13 runbook.
8. **Background work:** `node-cron`-style in-process scheduler in `server.ts` for: presence sweeps, expired token/invitation cleanup, notification digest (v2). No separate worker in v1.
