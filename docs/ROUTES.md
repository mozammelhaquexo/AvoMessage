# AvoMessage — Route Map (ROUTES)

> Page routes (App Router) + Socket.io room scheme. API routes live in
> `docs/ARCHITECTURE.md §7`. Route groups `(…)` don't affect URLs.

## 1. Public routes — `(public)`

| Path | Page | Notes |
|---|---|---|
| `/` | Landing / marketing | Redirects to `/home` when logged in |
| `/login` | Login | Redirects to `/home` when logged in |
| `/register` | Registration | |
| `/verify-email?token=` | Email verification result | Handles token, shows success/error |
| `/forgot-password` | Request reset link | |
| `/reset-password?token=` | Set new password | |
| `/invite/[token]` | Invitation accept | Shows company/team/role; prompts login/register if needed |
| `/p/[username]` | Public profile (SEO) | Limited view; canonical profile for logged-in users is `/profile/[username]` — **decision:** merge into one route `/profile/[username]` that adapts by auth state (simpler; SEO via metadata) |

**Decision:** single profile route `/profile/[username]` (adapts to viewer). No separate `/p/` route.

## 2. App routes — `(app)` (require session)

| Path | Page |
|---|---|
| `/home` | Home feed (following) + composer |
| `/explore` | Explore: trending posts + hashtags |
| `/notifications` | Notification center |
| `/messages` | Conversation list (+ empty state) |
| `/messages/[conversationId]` | Thread view |
| `/post/[id]` | Post detail + comments |
| `/profile/[username]` | Profile: posts, media tab, likes tab (own only) |
| `/profile/[username]/followers` | Followers list |
| `/profile/[username]/following` | Following list |
| `/bookmarks` | Saved posts |
| `/hashtag/[tag]` | Tag timeline |
| `/search?q=` | Unified search results |
| `/companies` | My companies list |
| `/companies/new` | Create company |
| `/company/[slug]` | Company workspace: feed, about, members preview |
| `/company/[slug]/members` | Member directory |
| `/company/[slug]/teams` | Teams list |
| `/company/[slug]/teams/[teamId]` | Team detail |
| `/call/[callId]` | Call screen (audio/video) |
| `/settings` | Settings hub |
| `/settings/profile` | Edit profile |
| `/settings/account` | Email, password, verification status |
| `/settings/sessions` | Active sessions + revoke |
| `/settings/privacy` | Blocks, mutes, private account |
| `/settings/notifications` | Notification preferences |

## 3. Manager routes — `/manage/[slug]` (require company MANAGER+)

| Path | Page |
|---|---|
| `/manage/[slug]` | Dashboard: stats, pending invites, recent activity |
| `/manage/[slug]/members` | Member management (roles, remove, invite) |
| `/manage/[slug]/teams` | Team management |
| `/manage/[slug]/invitations` | Invitation list (pending/expired/revoked) |
| `/manage/[slug]/settings` | Company settings + danger zone (owner-only sections) |

## 4. Admin routes — `/admin` (require ADMIN+)

| Path | Page |
|---|---|
| `/admin` | Overview stats |
| `/admin/users` | User search + management |
| `/admin/users/[id]` | User detail: profile, activity, login history, actions |
| `/admin/reports` | Moderation queue |
| `/admin/reports/[id]` | Report detail + resolution actions |
| `/admin/companies` | Company list + deactivate |
| `/admin/settings` | System settings editor |
| `/admin/audit-logs` | Audit trail browser |

## 5. Route guards (layouts)

- `app/(public)/layout.tsx` — redirects authenticated users away from login/register to `/home`.
- `app/(app)/layout.tsx` — `requireSession`, else redirect `/login?next=…`. Provides app shell (sidebar, socket provider, notification bell).
- `app/manage/[slug]/layout.tsx` — `requireCompanyManager`, else 403 page.
- `app/admin/layout.tsx` — `requireAdmin`, else 403 page.
- Unverified users: allowed in `(app)` but a global banner blocks write actions (server enforces anyway).

## 6. Socket.io room scheme

```
user:{userId}            # joined automatically on connect; notifications, feed fan-out,
                         # conversation list updates, incoming calls
conversation:{id}        # joined on viewing / active membership; messages, typing, receipts
company:{companyId}      # joined for company workspace views; company announcements (v2)
call:{callId}            # joined during a call; signaling + participant events
```

**Rules:**
- `user:{id}`: server-joined only, never client-requested for another user.
- `conversation:{id}` / `company:{id}` / `call:{id}`: client emits join request; server verifies membership via the same helpers as REST (`requireConversationMember`, `requireCompanyMember`, call participation) before `socket.join()`.
- Broadcasts never include the sender except where the client needs echo confirmation (use ack callbacks instead).
- On membership revocation (removed from conversation/company, user suspended): server emits `room:revoked { room }` to the affected `user:{id}` room; client leaves and refreshes.

## 7. API route tree (summary — full contract in ARCHITECTURE.md §7)

```
app/api/
  auth/{register,verify-email,resend-verification,login,logout,session,
        forgot-password,reset-password,sessions,sessions/[id],login-activity}/route.ts
  users/me/route.ts  users/[username]/route.ts
  users/[username]/{followers,following}/route.ts
  users/[id]/{follow,block,mute}/route.ts
  search/route.ts
  hashtags/trending/route.ts  hashtags/[tag]/route.ts
  feed/route.ts  feed/company/[companyId]/route.ts
  posts/route.ts  posts/[id]/route.ts
  posts/[id]/{like,bookmark,comments}/route.ts
  comments/[id]/route.ts
  conversations/route.ts  conversations/[id]/route.ts
  conversations/[id]/{members,members/[userId],messages,read}/route.ts
  messages/[id]/route.ts  messages/[id]/reactions/route.ts
  calls/route.ts  calls/history/route.ts  calls/[id]/route.ts
  calls/[id]/{accept,decline,end}/route.ts
  notifications/route.ts  notifications/[id]/read/route.ts  notifications/read/route.ts
  companies/route.ts  companies/[id]/route.ts
  companies/[id]/{members,members/[userId],invitations,teams,activity}/route.ts
  invitations/accept/route.ts  invitations/[id]/route.ts
  teams/[id]/route.ts  teams/[id]/members/route.ts  teams/[id]/members/[userId]/route.ts
  uploads/route.ts
  reports/route.ts
  admin/{stats,users,users/[id],reports,reports/[id],companies,settings,audit-logs}/route.ts
```

## 8. Not-found / error conventions

- Unknown page → `app/not-found.tsx` (branded 404).
- API unknown resource → `404 { error: { code: 'NOT_FOUND' } }`.
- Soft-deleted content → `410 { error: { code: 'GONE' } }` where the client should drop it from lists.
