/**
 * prisma-types.ts — hand-written Prisma type surface for AvoMessage.
 *
 * STOPGAP (Backend Engineer B, 2026-10-02): `@prisma/client` is not installed in
 * this environment and `prisma generate` cannot run here (no CLI, no DB).
 * These interfaces mirror `prisma/schema.prisma` EXACTLY (field names, types,
 * optionality) so service/route code can be written and type-checked today.
 *
 * Migration path: once `@prisma/client` is installed + generated, delete this
 * file and `lib/db.ts`'s lazy wrapper, and import types from `@prisma/client`
 * directly. Service code uses only standard Prisma query shapes, so the swap
 * should be mechanical. A `grep` for `prisma-types` finds every touch point.
 */

// ── Enums (mirror schema; Prisma generates these as string unions) ──────────
export type PlatformRole = "SUPER_ADMIN" | "ADMIN" | "USER";
export type CompanyRole = "OWNER" | "MANAGER" | "MEMBER";
export type TeamRole = "MANAGER" | "MEMBER";
export type PostVisibility = "PUBLIC" | "FOLLOWERS" | "COMPANY" | "PRIVATE";
export type ConversationType = "DM" | "GROUP";
export type ConversationRole = "OWNER" | "ADMIN" | "MEMBER";
export type MessageType = "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "VOICE" | "SYSTEM";
export type AttachmentKind = "IMAGE" | "VIDEO" | "FILE" | "VOICE";
export type CallType = "AUDIO" | "VIDEO";
export type CallStatus =
  | "INITIATED"
  | "RINGING"
  | "ONGOING"
  | "ENDED"
  | "MISSED"
  | "DECLINED"
  | "FAILED";
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
export type ReportTarget = "POST" | "COMMENT" | "MESSAGE" | "USER";
export type ReportReason =
  | "SPAM"
  | "HARASSMENT"
  | "HATE_SPEECH"
  | "NUDITY_OR_SEXUAL"
  | "VIOLENCE"
  | "MISINFORMATION"
  | "COPYRIGHT"
  | "OTHER";
export type ReportStatus = "PENDING" | "IN_REVIEW" | "ACTIONED" | "DISMISSED";
export type InvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
export type JoinRequestStatus = "PENDING" | "APPROVED" | "DECLINED";
export type TokenType = "EMAIL_VERIFICATION" | "PASSWORD_RESET";
export type OtpPurpose = "SIGNUP" | "COMPANY_MEMBER" | "COMPANY_MANAGER";

export type PresenceStatus =
  | "ONLINE"
  | "AWAY"
  | "DO_NOT_DISTURB"
  | "OFFLINE";

// ── Models ─────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  passwordHash: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  bio: string | null;
  website: string | null;
  location: string | null;
  isPrivate: boolean;
  isActive: boolean;
  isVerified: boolean;
  platformRole: PlatformRole;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastActiveAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface VerificationToken {
  id: string;
  userId: string;
  tokenHash: string;
  type: TokenType;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface OtpChallenge {
  id: string;
  purpose: OtpPurpose;
  email: string;
  codeHash: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  verifiedAt: Date | null;
  consumedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
}

export interface LoginActivity {
  id: string;
  userId: string | null;
  email: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  success: boolean;
  reason: string | null;
  createdAt: Date;
}

export interface UserPresence {
  userId: string;
  status: PresenceStatus;
  lastSeenAt: Date;
  updatedAt: Date;
}

export interface Post {
  id: string;
  authorId: string;
  body: string;
  visibility: PostVisibility;
  companyId: string | null;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  parentId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  title: string | null;
  avatarUrl: string | null;
  createdById: string | null;
  companyId: string | null;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMember {
  conversationId: string;
  userId: string;
  role: ConversationRole;
  lastReadAt: Date;
  isMuted: boolean;
  /** The member's own display name inside this conversation; null = real name. */
  nickname: string | null;
  joinedAt: Date;
}

/**
 * A private nickname one user gives another. Only `ownerId` ever sees it, so
 * it is a label on the relationship rather than a property of the target.
 */
export interface ContactNickname {
  ownerId: string;
  targetId: string;
  nickname: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A browser/device Web Push endpoint. `endpoint` is globally unique — it
 * identifies one browser profile — so re-subscribing updates the row instead
 * of adding a duplicate.
 */
export interface PushSubscription {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  failureCount: number;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string | null;
  body: string | null;
  type: MessageType;
  clientId: string | null;
  replyToId: string | null;
  forwardedFromId: string | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}

export interface MessageReaction {
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: Date;
}

export interface Attachment {
  id: string;
  messageId: string;
  kind: AttachmentKind;
  url: string;
  name: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  createdAt: Date;
}

export interface VoiceMessage {
  id: string;
  messageId: string;
  senderId: string;
  url: string;
  durationSeconds: number;
  waveform: unknown;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: Date;
}

export interface Call {
  id: string;
  conversationId: string | null;
  initiatorId: string;
  type: CallType;
  status: CallStatus;
  startedAt: Date;
  endedAt: Date | null;
}

export interface CallParticipant {
  callId: string;
  userId: string;
  joinedAt: Date;
  leftAt: Date | null;
}

export interface Notification {
  id: string;
  userId: string;
  actorId: string | null;
  type: NotificationType;
  entityType: string | null;
  entityId: string | null;
  title: string | null;
  body: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Per-user notification switches. One row per user, created lazily on first
 * save — a missing row means "all defaults", which are all true.
 */
export interface NotificationPreference {
  userId: string;
  likes: boolean;
  comments: boolean;
  follows: boolean;
  mentions: boolean;
  messages: boolean;
  invitations: boolean;
  announcements: boolean;
  calls: boolean;
  security: boolean;
  updatedAt: Date;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  coverUrl: string | null;
  brandColor: string | null;
  description: string | null;
  website: string | null;
  ownerId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanyMember {
  companyId: string;
  userId: string;
  role: CompanyRole;
  joinedAt: Date;
}

export interface Team {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  role: TeamRole;
  joinedAt: Date;
}

export interface Invitation {
  id: string;
  companyId: string;
  teamId: string | null;
  email: string;
  role: CompanyRole;
  tokenHash: string;
  invitedById: string;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
}

export interface CompanyJoinRequest {
  id: string;
  companyId: string;
  userId: string;
  message: string | null;
  status: JoinRequestStatus;
  reviewedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CompanyJoinRequestWithUser = CompanyJoinRequest & {
  user: User;
};

export type ManagerApplicationStatus = "PENDING" | "APPROVED" | "DECLINED" | "WITHDRAWN";

export interface ManagerApplication {
  id: string;
  userId: string;
  companyId: string | null;
  companyName: string;
  position: string;
  companySize: number;
  teamCount: number;
  teamSize: number;
  message: string | null;
  status: ManagerApplicationStatus;
  reviewedById: string | null;
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ManagerApplicationWithUser = ManagerApplication & { user: User };

export type ManagerApplicationFull = ManagerApplication & {
  user: User;
  company: Company | null;
  reviewedBy: User | null;
};

export interface Report {
  id: string;
  reporterId: string;
  targetType: ReportTarget;
  targetId: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  reviewerId: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface AuditLog {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: Date;
}

export interface SystemSetting {
  key: string;
  value: unknown;
  updatedById: string | null;
  updatedAt: Date;
}

export interface Follow {
  followerId: string;
  followingId: string;
  createdAt: Date;
}

export interface Block {
  blockerId: string;
  blockedId: string;
  createdAt: Date;
}

export interface Like {
  userId: string;
  postId: string;
  createdAt: Date;
}

export interface Bookmark {
  userId: string;
  postId: string;
  createdAt: Date;
}

// ── Named `include` result shapes (match lib/services/serialize.ts) ─────────
export type CompanyMemberWithUser = CompanyMember & { user: User };
export type CompanyMemberWithCompany = CompanyMember & { company: Company };
export type TeamMemberWithUser = TeamMember & { user: User };
export type PostWithAuthor = Post & { author: User };
export type CommentWithAuthor = Comment & { author: User };
export type MessageWithSender = Message & { sender: User };
export type MessageFull = Message & {
  sender: User | null;
  attachments: Attachment[];
  reactions: MessageReaction[];
  voice: VoiceMessage | null;
  /** Quoted parent, when this message is a reply. */
  replyTo: MessageWithSender | null;
  /** Original message, when this message is a forward. */
  forwardedFrom: MessageWithSender | null;
};
export type ConversationMemberWithUser = ConversationMember & { user: User };
export type ConversationWithMembers = Conversation & {
  members: ConversationMemberWithUser[];
};
export type ConversationMemberWithConversation = ConversationMember & {
  conversation: Conversation;
};
export type CallParticipantWithUser = CallParticipant & { user: User };
export type CallFull = Call & {
  initiator: User;
  participants: CallParticipantWithUser[];
};
export type CallParticipantWithCall = CallParticipant & { call: CallFull };
export type InvitationFull = Invitation & {
  company: Company;
  team: Team | null;
  invitedBy: User;
};
export type ReportFull = Report & { reporter: User; reviewer: User | null };
export type AuditLogWithActor = AuditLog & { actor: User | null };

// ── Minimal Prisma-client-like delegate surface ─────────────────────────────
// Args are `any`: without the generated client we cannot type-check query
// shapes. Return values ARE typed. The `R` type parameter lets call sites
// declare `include` shapes, e.g.
//   db.post.findMany<PostWithAuthor>({ include: { author: true } })
// MIGRATION: when the real client lands and this file is deleted, drop the
// explicit `<...>` type arguments at call sites — the generated delegates
// infer include shapes from their own (non-defaulted) generics.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ModelDelegate<T> {
  findUnique<R = T>(args: any): Promise<R | null>;
  findFirst<R = T>(args?: any): Promise<R | null>;
  findMany<R = T>(args?: any): Promise<R[]>;
  create<R = T>(args: any): Promise<R>;
  update<R = T>(args: any): Promise<R>;
  upsert<R = T>(args: any): Promise<R>;
  delete<R = T>(args: any): Promise<R>;
  deleteMany(args?: any): Promise<{ count: number }>;
  updateMany(args: any): Promise<{ count: number }>;
  count(args?: any): Promise<number>;
  aggregate(args: any): Promise<any>;
  groupBy(args: any): Promise<any[]>;
  createMany(args: any): Promise<{ count: number }>;
}

/** Transaction client: same delegates (Prisma interactive transactions). */
export type TxClient = PrismaClientLike;

/** Stand-in for the generated PrismaClient. */
export interface PrismaClientLike {
  user: ModelDelegate<User>;
  session: ModelDelegate<Session>;
  verificationToken: ModelDelegate<VerificationToken>;
  otpChallenge: ModelDelegate<OtpChallenge>;
  loginActivity: ModelDelegate<LoginActivity>;
  userPresence: ModelDelegate<UserPresence>;
  post: ModelDelegate<Post>;
  comment: ModelDelegate<Comment>;
  conversation: ModelDelegate<Conversation>;
  conversationMember: ModelDelegate<ConversationMember>;
  contactNickname: ModelDelegate<ContactNickname>;
  pushSubscription: ModelDelegate<PushSubscription>;
  message: ModelDelegate<Message>;
  messageReaction: ModelDelegate<MessageReaction>;
  attachment: ModelDelegate<Attachment>;
  voiceMessage: ModelDelegate<VoiceMessage>;
  call: ModelDelegate<Call>;
  callParticipant: ModelDelegate<CallParticipant>;
  notification: ModelDelegate<Notification>;
  notificationPreference: ModelDelegate<NotificationPreference>;
  company: ModelDelegate<Company>;
  companyMember: ModelDelegate<CompanyMember>;
  team: ModelDelegate<Team>;
  teamMember: ModelDelegate<TeamMember>;
  invitation: ModelDelegate<Invitation>;
  companyJoinRequest: ModelDelegate<CompanyJoinRequest>;
  managerApplication: ModelDelegate<ManagerApplication>;
  report: ModelDelegate<Report>;
  auditLog: ModelDelegate<AuditLog>;
  systemSetting: ModelDelegate<SystemSetting>;
  follow: ModelDelegate<Follow>;
  block: ModelDelegate<Block>;
  like: ModelDelegate<Like>;
  bookmark: ModelDelegate<Bookmark>;
  $transaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T>;
  $transaction<T extends any[]>(ops: [...T]): Promise<{ [K in keyof T]: Awaited<T[K]> }>;
  /**
   * Raw SQL escape hatch. Used for aggregate queries the typed delegates cannot
   * express — grouping by day, counting distinct users inside a window — so the
   * database does the counting instead of streaming every row into Node.
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $disconnect(): Promise<void>;
}

/** Slim actor shape passed to services (avoids re-fetching the user). */
export interface Actor {
  id: string;
  name: string;
  email: string;
  platformRole: PlatformRole;
  emailVerifiedAt: Date | null;
  isActive: boolean;
}
