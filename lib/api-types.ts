/**
 * lib/api-types.ts — frontend TypeScript shapes for AvoMessage REST APIs.
 *
 * These mirror the serialized shapes returned by the backend services
 * (see docs/ARCHITECTURE.md §7 and lib/services/*). Dates arrive as ISO
 * strings over the wire even when services type them as `Date`.
 */

export type PlatformRole = "USER" | "ADMIN" | "SUPER_ADMIN";
/** Company-scoped role — mirrors `CompanyMember.role` in prisma/schema.prisma. */
export type CompanyRoleName = "OWNER" | "MANAGER" | "MEMBER";
export type PostVisibility = "PUBLIC" | "FOLLOWERS" | "COMPANY" | "PRIVATE";

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string[]> };
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

/** The user object returned by /api/auth/me, /api/users/me, login, register. */
export interface SessionUser {
  id: string;
  name: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  bio: string | null;
  website: string | null;
  location: string | null;
  isPrivate: boolean;
  isVerified: boolean;
  emailVerified: boolean;
  platformRole: PlatformRole;
  createdAt: string;
  counts?: { followers: number; following: number; posts: number };
}

export interface PostAuthor {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  isVerified: boolean;
  /**
   * Platform role — drives the Admin chip. Optional because only the post
   * serializers populate it; comment authors and notification actors reuse
   * this shape without it.
   */
  platformRole?: PlatformRole;
  /** Company memberships — drives the Manager chip and company chips. */
  companies?: Array<{ name: string; slug: string; role: CompanyRoleName }>;
}

export interface PostMedia {
  id: string;
  url: string;
  kind: string;
  width: number | null;
  height: number | null;
}

export interface Post {
  id: string;
  body: string;
  visibility: PostVisibility;
  companyId: string | null;
  author: PostAuthor;
  media: PostMedia[];
  counts: { likes: number; comments: number; shares: number };
  viewerState: { liked: boolean; bookmarked: boolean } | null;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  body: string;
  author: PostAuthor;
  likeCount: number;
  liked: boolean | null;
  parentId: string | null;
  replies: Comment[];
  createdAt: string;
  updatedAt: string;
}

export interface ViewerState {
  following: boolean;
  followedBy: boolean;
  blocked: boolean;
  blockedBy: boolean;
  muted: boolean;
  self: boolean;
}

export interface PublicProfile {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  bio: string | null;
  website: string | null;
  location: string | null;
  isPrivate: boolean;
  isVerified: boolean;
  /** Platform role — drives the Admin chip. Present even on a limited profile. */
  platformRole?: PlatformRole;
  /** Company memberships — drives the Manager chip and company chips.
   *  Empty on a limited (private-account) profile. */
  companies?: Array<{ name: string; slug: string; role: CompanyRoleName }>;
  createdAt: string;
  counts?: { followers: number; following: number; posts: number };
  viewerState: ViewerState | null;
}

export type NotificationType =
  | "LIKE"
  | "COMMENT"
  | "FOLLOW"
  | "MENTION"
  | "MESSAGE"
  | "CALL_MISSED"
  | "INVITATION_RECEIVED"
  | "INVITATION_ACCEPTED"
  | "COMPANY_ROLE_CHANGED"
  | "TEAM_ADDED"
  | "REPORT_STATUS"
  | "SYSTEM";

/** entityType values are lowercase strings: "post" | "comment" | "message" | "conversation" | "company" | "team" | "user". */
export interface NotificationItem {
  id: string;
  type: NotificationType;
  entityType: string | null;
  entityId: string | null;
  title: string | null;
  body: string | null;
  readAt: string | null;
  actor: PostAuthor | null;
  createdAt: string;
}

export interface SearchUser {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  isVerified: boolean;
  createdAt: string;
}

export interface HashtagResult {
  tag: string;
  usageCount: number;
}

export interface CompanySummary {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  description: string | null;
  viewerRole?: string;
}

export interface UploadedFile {
  id: string;
  url: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
}

export interface AuthSessionInfo {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastActiveAt: string;
  createdAt: string;
  current: boolean;
}

export interface LoginActivityItem {
  id: string;
  success: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  reason: string | null;
  createdAt: string;
}

export type NotificationPrefs = Record<
  | "likes"
  | "comments"
  | "follows"
  | "mentions"
  | "messages"
  | "invitations"
  | "announcements"
  | "calls"
  | "security",
  boolean
>;

/* ── Manager applications (feature 10) ─────────────────────────────────── */

export type ManagerApplicationStatus = "PENDING" | "APPROVED" | "DECLINED" | "WITHDRAWN";

export interface ManagerApplicationApplicant {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

export interface ManagerApplicationCompanyRef {
  id: string;
  name: string;
  slug: string;
}

export interface ManagerApplicationItem {
  id: string;
  status: ManagerApplicationStatus;
  companyId: string | null;
  companyName: string;
  position: string;
  /** Total headcount at the company. */
  companySize: number;
  /** How many teams the applicant would run. */
  teamCount: number;
  /** People per team. */
  teamSize: number;
  message: string | null;
  /** The admin's note on the decision — shown to the applicant. */
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  applicant?: ManagerApplicationApplicant;
  company?: ManagerApplicationCompanyRef | null;
  reviewer?: ManagerApplicationApplicant | null;
}

/* ── Auth helpers (feature 6/7) ────────────────────────────────────────── */

/**
 * Response of `GET /api/auth/username-available`.
 *
 * Lives here rather than in the route file so the sign-up form (a client
 * component) can import the type without pulling the route's server-only
 * imports — `@/lib/db`, Prisma — into the browser bundle.
 */
export interface UsernameAvailability {
  username: string;
  available: boolean;
  /** Why it is unavailable — shown verbatim under the field. */
  reason: string | null;
}
