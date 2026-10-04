# AvoMessage — Roles & Permissions (RBAC)

> Single source of truth for authorization. **All enforcement is server-side**
> (route handlers + services + socket handlers). Frontend uses the same matrix
> only to hide/show UI — never to grant access.

## 1. Role tiers

| Tier | Roles | Scope |
|---|---|---|
| Platform | `SUPER_ADMIN`, `ADMIN`, `USER` | `User.platformRole` — whole platform |
| Company | `OWNER`, `MANAGER`, `MEMBER` | `CompanyMember.role` — per company |
| Team | `MANAGER`, `MEMBER` | `TeamMember.role` — per team |
| Conversation | `OWNER`, `ADMIN`, `MEMBER` | `ConversationMember.role` — per conversation |

Role hierarchy (strictly ordered, higher includes lower): `SUPER_ADMIN > ADMIN > USER`;
`OWNER > MANAGER > MEMBER`. Team roles never grant company-level power.

## 2. Permission matrix

Legend: ✅ allowed · ❌ denied · ◐ conditional (see notes)

### 2.1 Platform administration

| Capability | SUPER_ADMIN | ADMIN | Manager (company) | Member | User |
|---|---|---|---|---|---|
| Manage platform users (suspend, role) | ✅ | ✅¹ | ❌ | ❌ | ❌ |
| Grant/revoke ADMIN | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage system settings | ✅ | ✅ | ❌ | ❌ | ❌ |
| Review reports queue | ✅ | ✅ | ❌ | ❌ | ❌ |
| Delete any post/comment/message | ✅ | ✅ | ◐² | ❌ | own only |
| View audit logs | ✅ | ✅ | ◐³ | ❌ | ❌ |
| Deactivate any company | ✅ | ✅ | ❌ | ❌ | ❌ |

¹ ADMIN cannot suspend/change another ADMIN or SUPER_ADMIN.
² Company MANAGER+ can delete COMPANY-visibility posts/comments in their company.
³ Company MANAGER+ sees audit entries scoped to their company only.

### 2.2 Company management

| Capability | OWNER | MANAGER | MEMBER | Non-member |
|---|---|---|---|---|
| Edit company profile | ✅ | ✅ | ❌ | ❌ |
| Change member role | ✅ (any) | ✅ (MEMBER↔MANAGER only) | ❌ | ❌ |
| Remove member | ✅ | ✅ (not OWNER/MANAGER) | ❌ | ❌ |
| Invite members | ✅ | ✅ | ❌ | ❌ |
| Revoke invitations | ✅ | ✅ | ❌ | ❌ |
| Create/edit/delete teams | ✅ | ✅ | ❌ | ❌ |
| Add/remove team members | ✅ | ✅ | ❌ | ❌ |
| Transfer ownership | ✅ | ❌ | ❌ | ❌ |
| Deactivate company | ✅ | ❌ | ❌ | ❌ |
| View company | ✅ | ✅ | ✅ | ❌ |
| Post to company feed | ✅ | ✅ | ✅ | ❌ |

**Invariants:** a company always has ≥1 OWNER; the last OWNER cannot leave or be demoted; OWNER cannot be removed/demoted by MANAGER.

### 2.3 Teams

| Capability | Team MANAGER | Team MEMBER | Company non-team-member |
|---|---|---|---|
| Edit team profile | ✅ | ❌ | ❌ |
| View team | ✅ | ✅ | ✅ (company members) |

Team MANAGER does **not** imply company MANAGER powers.

### 2.4 Content & social

| Capability | Rule |
|---|---|
| Create post/comment/message | authenticated + email verified + not suspended |
| Edit own post/comment | author, any time (marked edited) |
| Edit own message | sender, within 15 min |
| Delete own post/comment/message | author/sender (soft delete) |
| Delete others' post/comment | post author (comments on own post), company MANAGER+ (COMPANY posts), ADMIN+ |
| View post | PUBLIC: anyone; FOLLOWERS: followers+author; COMPANY: company members; PRIVATE: author |
| Like/bookmark | can view + authenticated |
| DM a user | both not blocking each other; recipient allows DMs (v1: everyone; setting in v2) |
| Join conversation | invited/added by admin, or via company team link |
| Report content/user | authenticated, not own content |

### 2.5 Calls
Only conversation members (or explicitly invited `userIds` at initiate time) may join/signal in a call. Signaling relay checks `CallParticipant` (or conversation membership for new joins).

## 3. Enforcement helpers

Implement in `lib/auth/permissions.ts`. All are server-side; each throws typed errors
(`Unauthenticated`, `Forbidden`, `EmailUnverified`, `Suspended`) mapped to HTTP codes.

```ts
requireSession(req): Promise<{ user: User; session: Session }>
  // Verifies signed cookie → session row → not revoked/expired → not suspended.
  // Refreshes sliding expiry (debounced). Used by every 🔒 route.

requireVerified(user): void
  // Throws EmailUnverified (403) if !user.emailVerifiedAt. Wraps write actions.

requireRole(user, min: PlatformRole): void
  // Platform hierarchy check.

requireAdmin(user): void        // requireRole(user, 'ADMIN')
requireSuperAdmin(user): void   // user.platformRole === 'SUPER_ADMIN'

requireCompanyMember(userId, companyId, min: CompanyRole = 'MEMBER')
  : Promise<CompanyMember>
  // Throws Forbidden if no membership or role < min. Returns membership row.

requireCompanyManager(userId, companyId)  // requireCompanyMember(..., 'MANAGER')
requireCompanyOwner(userId, companyId)    // requireCompanyMember(..., 'OWNER')

requireConversationMember(userId, conversationId, min: ConversationRole = 'MEMBER')
  : Promise<ConversationMember>

requireTeamMember(userId, teamId, min: TeamRole = 'MEMBER')

canViewPost(viewer: User | null, post: Post): boolean
canViewProfile(viewer, profile): 'full' | 'limited' | 'none'
isBlockedEitherWay(aId, bId): Promise<boolean>  // blocks DM, mentions, notifications
```

**Where they run:**
- **Route handlers** (`app/api/**/route.ts`): call the appropriate helper(s) first, before any service call.
- **Services** (`lib/services/*`): re-assert ownership checks that depend on loaded rows (defense in depth; services never trust caller claims).
- **Socket handlers** (`lib/realtime/*`): `requireSession`-equivalent on handshake; `requireConversationMember` before room join and before relaying `call:signal` / `message:send`.
- **Server Components / pages**: `requireSession` in layouts for `(app)`, `(manage)`, `(admin)` route groups; redirect to `/login` when unauthenticated, to `/home` when unauthorized.

## 4. Sensitive operations checklist

Every one of these must: (a) pass the helpers above, (b) run in a transaction where multi-row, (c) write an `AuditLog` row.

- Platform role change, suspend/unsuspend user
- Company role change, member removal, ownership transfer, company deactivation
- Invitation revoke, system setting change
- Admin content deletion, report resolution with action

## 5. Frontend guidance (non-enforcing)

- Derive visible UI from `viewerState` / `viewerRole` fields returned by APIs (never from client-side role strings stored locally).
- On `403` with code `EMAIL_UNVERIFIED` → show verification banner. On `ACCOUNT_SUSPENDED` → log out + suspended screen.
- Socket client must handle `error` events carrying `{ code: 'FORBIDDEN' }` (e.g. removed from conversation mid-session → leave room, refresh list).
