/**
 * lib/types.ts — client-side TypeScript views of the AvoMessage API.
 *
 * Mirrors the server view shapes in `lib/services/serialize.ts`
 * (PublicUser, PublicCompany, MessageView, ConversationView, …).
 * The socket payloads in `lib/realtime/events.ts` use slightly different
 * field names (`author` vs `sender`); normalizers in `lib/chat.ts` bridge them.
 */

/* ── Users ─────────────────────────────────────────────────────────────── */

import type { Page } from "./api-types";

/** Alias of the canonical paginated-list shape (`Page`) — one definition. */
export type Paginated<T> = Page<T>;

export interface PublicUser {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  isVerified: boolean;
  createdAt: string;
}

export type PlatformRole = "SUPER_ADMIN" | "ADMIN" | "USER";

export interface SessionUser extends PublicUser {
  email: string;
  platformRole: PlatformRole;
  emailVerifiedAt: string | null;
  isActive: boolean;
}

/* ── Conversations & messages ──────────────────────────────────────────── */

export type ConversationType = "DM" | "GROUP";
export type ConversationRole = "OWNER" | "ADMIN" | "MEMBER";
export type MessageType = "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "VOICE" | "SYSTEM";
export type AttachmentKind = "IMAGE" | "VIDEO" | "FILE" | "VOICE";

export interface ConversationMemberView {
  user: PublicUser;
  role: ConversationRole;
  isMuted: boolean;
  lastReadAt: string;
  joinedAt: string;
}

export interface AttachmentView {
  id: string;
  kind: AttachmentKind;
  url: string;
  name: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
}

export interface ReactionView {
  emoji: string;
  count: number;
  /** Whether the current viewer reacted with this emoji. */
  reacted: boolean;
}

export interface VoiceMessageView {
  id: string;
  messageId: string;
  senderId: string;
  url: string;
  durationSeconds: number;
  waveform: number[] | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

export interface ReplyToView {
  id: string;
  sender: PublicUser | null;
  /**
   * Name-only fallback. A socket `message:new` carries just the author's name
   * (no full PublicUser), and the quote preview must still be able to label
   * itself without a second round-trip.
   */
  authorName?: string | null;
  body: string | null;
  /** True when the source has been soft-deleted — the bubble shows a label. */
  deleted?: boolean;
}

/** Normalized message — merged from REST `messageView` or socket payload. */
export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string | null;
  body: string | null;
  type: MessageType;
  createdAt: string;
  editedAt: string | null;
  sender: PublicUser | null;
  attachments: AttachmentView[];
  reactions: ReactionView[];
  voice: VoiceMessageView | null;
  replyTo: ReplyToView | null;
  /** Set when this message is a forward of another message. */
  forwardedFrom: ReplyToView | null;
  /** Local-only flags (optimistic send / tombstone). */
  pending?: boolean;
  failed?: boolean;
  deleted?: boolean;
  /**
   * The id this client generated for an optimistic send, kept after the server
   * assigns the real `id`.
   *
   * It exists to be a STABLE React key across the optimistic → persisted swap.
   * Keyed on `id`, that swap unmounts one element and mounts another, so the
   * entrance animation played a second time and the bubble appeared to jump.
   * `clientId` is the same string on both sides of the swap, so the swap is an
   * update and the animation runs exactly once.
   */
  clientId?: string;
}

export interface ConversationView {
  id: string;
  type: ConversationType;
  title: string | null;
  avatarUrl: string | null;
  companyId: string | null;
  members: ConversationMemberView[];
  lastMessage: ChatMessage | null;
  unreadCount: number;
  lastMessageAt: string;
}

/* ── (Paginated is defined at the top of this file as an alias of Page) ── */

/* ── Companies & teams ─────────────────────────────────────────────────── */

export type CompanyRole = "OWNER" | "MANAGER" | "MEMBER";
export type TeamRole = "MANAGER" | "MEMBER";

export interface PublicCompany {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  coverUrl: string | null;
  brandColor: string | null;
  description: string | null;
  website: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface CompanyMembership {
  company: PublicCompany;
  role: CompanyRole;
  joinedAt: string;
}

export interface CompanyDetail {
  company: PublicCompany;
  viewerRole: CompanyRole;
  counts: { members: number; teams: number; posts: number };
}

export interface CompanyMemberView {
  user: PublicUser;
  role: CompanyRole;
  joinedAt: string;
}

export interface PublicTeam {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
}

export interface TeamMemberView {
  user: PublicUser;
  role: TeamRole;
  joinedAt: string;
}

export type InvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";

export interface InvitationView {
  id: string;
  email: string;
  role: CompanyRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  teamId: string | null;
  teamName?: string | null;
  invitedBy?: PublicUser | null;
}

/* ── Posts (minimal — full PostCard lives with Frontend Engineer A) ────── */

export type PostAuthor = PublicUser;

export interface PostSummary {
  id: string;
  body: string;
  visibility: string;
  companyId: string | null;
  author: PostAuthor | null;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  viewerState?: { liked: boolean; bookmarked: boolean };
}

/* ── Admin ─────────────────────────────────────────────────────────────── */

export interface AdminUserRow {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  email: string;
  platformRole: PlatformRole;
  isActive: boolean;
  isVerified: boolean;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export interface AdminDashboard {
  users: number;
  posts: number;
  messages: number;
  companies: number;
  reportsPending: number;
  signups7d: number;
}

export type ReportStatus = "PENDING" | "IN_REVIEW" | "ACTIONED" | "DISMISSED";

export interface ReportRow {
  id: string;
  reporterId: string;
  targetType: string;
  targetId: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  reviewerId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  reporter?: PublicUser | null;
}

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  actor?: PublicUser | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AnalyticsPoint {
  date: string;
  count: number;
}

export interface AnalyticsData {
  dau: number;
  wau: number;
  mau: number;
  postsPerDay: AnalyticsPoint[];
  messagesPerDay: AnalyticsPoint[];
  signupsPerDay: AnalyticsPoint[];
}
