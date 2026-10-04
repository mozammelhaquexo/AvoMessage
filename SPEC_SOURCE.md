# AvoMessage — Product Specification (source of truth for the build team)

Product name: **AvoMessage**. A production-grade social messaging + company collaboration platform.
Working directory for the build: `~/workspace/avomessage/`

## Product vision
AvoMessage combines: social network, real-time messaging, company/team collaboration, private company
communities, voice messages, audio calling, profiles, public "World" feed, admin management,
manager/company management, notifications, search and discovery, real-time online presence.
Feel: modern, premium, fast, expressive, highly polished. Original visual identity — do NOT clone
Twitter/X or any other product pixel-for-pixel. Familiar interaction patterns are fine.

## Brand & visual identity
Premium, energetic, futuristic, social, trustworthy, friendly, polished, mobile-first, desktop-class.
Rich but controlled colors, beautiful gradients, glass/soft-surface effects where appropriate, excellent
contrast, elegant typography, rounded modern surfaces, expressive icons, micro-interactions, subtle
background motion, hover states, spring-style transitions, skeleton loaders, animated modals/drawers,
smooth page transitions. Motion intentional and premium, not excessive.
Dark theme + light theme + system preference. Complete reusable design-token system: colors, typography,
spacing, radius, shadows, borders, animation durations, z-index layers, breakpoints.

## Architecture decisions (follow; document deviations in ARCHITECTURE.md)
- Next.js (App Router) + TypeScript (strict) + Tailwind CSS. Hand-rolled accessible UI primitives in
  shadcn spirit (no interactive CLIs).
- Prisma ORM + PostgreSQL (production DB). Local Postgres provisioned on this machine; also ship
  `docker-compose.yml` and document managed-Postgres path (Neon/Supabase). `.env.example`, never commit secrets.
- Auth: email/password with bcryptjs (cost 12), DB-backed sessions via signed httpOnly cookies
  (SameSite=Lax, Secure in prod), CSRF tokens on mutations, email verification + password reset with
  hashed single-use expiring tokens, login-activity tracking, session/device revocation.
  Mailer abstraction: log driver in dev, Resend/SMTP via env in prod.
- Realtime: Socket.io on a custom Next.js server (`server.ts`): presence, typing indicators, message
  delivery/read receipts, live notifications, live feed updates, call signaling, voice-message state.
- Storage: abstraction — local disk driver for dev, S3-compatible via env for prod (document MinIO/AWS).
  Validate MIME, extension, size server-side.
- Calls: WebRTC (P2P) with Socket.io signaling; STUN/TURN via env; full call-state machine
  (ringing/accept/reject/connecting/connected/mute/timer/quality/end/failed/reconnect) + persisted call
  history with strict privacy.
- Voice messages: MediaRecorder capture → upload → playback with waveform/seek; graceful mic-permission denial.
- Testing: Vitest for unit + API/integration tests, with mandatory authorization-matrix tests:
  (a) company-private posts unreachable by non-members incl. direct API access,
  (b) managers cannot touch another company's data,
  (c) non-admin/manager users blocked from admin/manager endpoints.
  Plus messaging, posts/comments/likes, notifications tests. Playwright only if time permits; else document e2e plan.

## Roles & permission matrix
- Super Admin: full platform control.
- Admin: broad operational/moderation access per permissions.
- Manager: company/team management only within assigned scope.
- Employee/Member: normal company access.
- User: normal social/messaging access.
Explicitly separate: platform permissions, company permissions, group permissions, content ownership
permissions. Test every protected action server-side.

## Authentication pages
Login, Sign Up, Email Verification, Forgot Password, Reset Password, Account Recovery; 2FA-ready
architecture. Layout: left contextual/brand panel, right active form; premium brand visuals; smooth
transitions; animated validation; password visibility toggle; strong client + server validation; clear
error/success feedback. Sign-up fields: full name, username, email, password, confirm password, optional
profile image. Never store plaintext passwords.

## Landing page
Hero, value proposition, social/messaging/company-collaboration/voice-call features, privacy/security,
feature highlights, CTA, footer. Hero: strong headline, concise message, animated product preview, Login /
Sign Up / secondary CTA, subtle motion.

## Main app shell
Desktop: left nav sidebar, central content, optional right utility panel. Mobile: bottom nav, slide-over
menus, full-screen composer. Sidebar: Home, World, Messages, Notifications, Profile, Companies, Create
Post, Search, Settings, Help/Support, Logout. Show avatar, username, online status, notification badge,
unread message badge.

## Profiles
Avatar, cover/banner, display name, username, bio, company affiliation, joined date, online status, post
count, followers/following. Tabs: media/posts, replies, liked (privacy-permitting). Actions: Edit Profile,
Follow/Unfollow, Message, Mute, Block, Report. Settings: privacy, notifications, security, password
change, session/device management.

## World feed (public social space)
Public posts by permitted users, visible to eligible users. Comment, like, reply, share/repost,
media, hashtags, mentions, report. Chronological + personalized options, infinite scroll,
pull-to-refresh on mobile, skeleton loading, empty state, error recovery.

## Company system
Company: name, logo, cover, description, industry, website, created date, owner/admin, managers,
employees/members. Company page tabs: Overview, Feed, Members, Managers, Groups/Teams, Announcements,
Media, About, Settings. PRIVACY RULE: company-private posts visible ONLY to authorized members —
enforced server-side (API + DB scoping), never frontend-only.

## Manager panel
Dashboard: member count, online count, managers count, teams count, recent posts/activity, pending
invitations, recent joins, reports. Actions: add/invite member by email, create member account (secure
temp credentials, force first-login reset, audit-logged), assign role, remove/suspend member, create
team/group, manage membership, publish announcements, moderate company posts/comments, view activity,
search members.

## Admin panel
Metrics: total/active/online users, managers, companies, posts, comments, likes, messages, active calls,
pending reports, suspended accounts, recent signups/activity. Charts: user growth, active users,
posts/messages over time, company growth, moderation activity. Sections: Dashboard, Users, Managers,
Companies, Posts, Comments, Reports, Moderation, Roles & Permissions, Audit Logs, System Settings,
Announcements, Analytics. Actions: search users, view details, manage roles, suspend/restore, inspect
companies/reports, moderate content, audit events, platform settings. Strict server-side authorization.

## Teams/groups
Name, description, image, private/public-to-company visibility, member list, group posts, group chat,
announcements, files, voice messages. Access respects membership.

## Messaging
1:1, group, company/group chat. Timestamps, delivery/read state, unread counts, typing indicator, online
presence, reply, edit, delete, reactions, attachments, emoji picker, voice message, link-preview
architecture, message search, conversation search, pin, mute, archive. Real-time updates.

## Voice messages
Hold/record, preview, cancel, send, play/pause, seek, duration, sent time, delete-own per policy.
Recording UI: animated waveform, elapsed time, cancel, send, mic-permission error state.

## Audio calls
1:1 and group audio architecture. Flow: initiate → incoming UI → accept/reject → connecting → connected →
mute/unmute → timer → quality indicator → end → failed/reconnect. Call history: caller, participants,
start/end, duration, status. Private metadata protected.

## Posts
Text, images, video architecture, links, hashtags, mentions; visibility: world/public, company-only,
group-only. Interactions: like/unlike, comment, reply, repost/share, bookmark/save, report, delete own,
edit own. Composer: char counter, media preview, visibility selector, emoji, mentions, hashtags,
drag/drop upload.

## Comments
Create, edit, delete own, like, reply, nested discussion (depth limits + pagination), report, moderation.

## Notifications
Realtime: new message, reply, like, comment, mention, follow, company/group invitation, manager action,
announcement, call event, security event. Center: unread/read, mark-all-read, filtering, grouping,
deep links.

## Search
Users, usernames, companies, groups, hashtags, posts, messages (permitted). Suggestions, recent searches,
filters, empty/loading states. Permissions respected.

## Moderation & safety
Report user/post/comment/message, block, mute, moderation queue, admin review, manager-level company
moderation, reason categories, audit history. Rate limiting, spam prevention, upload validation,
size/type limits, secure content handling.

## Analytics
Admin: DAU/WAU/MAU, new/active users, posts/comments/messages per day, call activity, company/member
growth, moderation metrics. Manager: members, active members, team activity, posts, engagement.
Admin analytics never exposed to regular users.

## Database entities (adapt as needed)
users, profiles, sessions, roles, permissions, user_roles, companies, company_members, company_managers,
teams, team_members, posts, post_media, comments, comment_likes, post_likes, follows, bookmarks,
conversations, conversation_members, messages, message_reactions, message_attachments, voice_messages,
calls, call_participants, notifications, reports, blocks, mutes, audit_logs, invitations, hashtags,
mentions, user_presence, system_settings. Indexes, uniqueness constraints, FKs, soft-delete where
appropriate, timestamps, migrations.

## Responsive
Desktop: wide sidebar + feed + right widgets. Tablet: condensed nav. Mobile: bottom nav, mobile chat,
full-screen composer, touch controls, drawers, optimized call UI. Verify at 320/375/390/414/768/1024/1280/1440+.

## Animation
Page transitions, card entry, sidebar, modal enter/exit, hover, buttons, badges, like reaction, message
arrival, typing indicator, recording waveform, call transitions, skeletons. Respect
prefers-reduced-motion.

## Accessibility
Keyboard nav, focus states, semantic HTML, screen-reader labels, accessible dialogs/forms, contrast,
visible errors, reduced motion, touch targets. WCAG-aware.

## Error/empty/loading states
Every important page/action: loading, empty, error, success states. Reusable state components. No blank
screens.

## Security (mandatory)
Password hashing, secure cookies/sessions, authorization middleware, server-side permission enforcement,
CSRF protection, XSS-safe rendering, input validation, output sanitization, rate limiting, brute-force
protection, secure file uploads (MIME/type/size), secret management, audit logs, session revocation,
login activity tracking, secure password reset, email verification. No secrets in frontend. Never trust
frontend role checks.

## Performance
Indexed queries, pagination, infinite scroll, image delivery, lazy loading, code splitting, caching,
optimistic UI, realtime subscriptions, virtualized long lists where needed. No giant datasets in browser.

## Routes
Public: `/`, `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`.
App: `/home`, `/world`, `/messages`, `/messages/[conversationId]`, `/notifications`, `/profile/[username]`,
`/settings`, `/search`, `/companies`, `/companies/[companyId]`, `/companies/[companyId]/members`,
`/companies/[companyId]/teams`, `/companies/[companyId]/teams/[teamId]`.
Manager: `/manager`, `/manager/company`, `/manager/members`, `/manager/teams`, `/manager/posts`,
`/manager/announcements`, `/manager/activity`.
Admin: `/admin`, `/admin/users`, `/admin/managers`, `/admin/companies`, `/admin/posts`, `/admin/comments`,
`/admin/reports`, `/admin/moderation`, `/admin/roles`, `/admin/audit-logs`, `/admin/analytics`, `/admin/settings`.

## Email/invitations
Manager enters email → validate → invitation created → email sent → recipient onboards → membership
linked. Expiration, resend, revoke, audit trail.

## Demo data
Seed users, managers, companies, teams, posts, comments, conversations, notifications, reports. Clearly
marked demo accounts.

## Phases
0 Discovery (feature spec) → 1 Architecture → 2 Design system → 3 Auth → 4 Core user system → 5 Social →
6 Messaging → 7 Calling → 8 Company → 9 Manager panel → 10 Admin → 11 Polish → 12 QA → 13 Production.

## Hard rules
No fake buttons. No dead-end TODOs in core flows. No hardcoded data where DB/service belongs. No
plaintext passwords. No frontend-only authorization. No company-private data leaks via APIs. Reusable
components; design system everywhere; maintainable code; mobile-first; elegant animations; realistic
states; confirmations for destructive actions; audit trails for admin/manager actions; document
architectural decisions; tests after each phase; full cross-feature integration test before completion.
Never call it production-ready unless security, permissions, error handling, and persistence are real.

## Definition of done
Auth works end-to-end; DB + migrations work; RBAC enforced and tested; posts/comments/likes/follows/
bookmarks work; realtime messaging works (delivery, read receipts, typing, presence); notifications work;
voice messages work; audio calls work or have documented production-ready implementation; company privacy
holds; manager + admin panels functional; responsive UI; accessibility addressed; automated tests exist
and pass; security review done; loading/error/empty states exist; deployment docs + env docs + seed data
work.
