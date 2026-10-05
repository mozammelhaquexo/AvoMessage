/**
 * zod schemas — single source of input truth at every API boundary
 * (ARCHITECTURE.md §1). Route handlers parse with these; services may assume
 * validated input.
 */
import { z } from 'zod';

// ─── Primitives ─────────────────────────────────────────────────────────────

export const usernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(24, 'Username must be at most 24 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers and underscores');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Invalid email address')
  .max(254);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

export const cuidSchema = z.string().min(1, 'Invalid id');

const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());

/**
 * A reference to an uploaded image: an absolute http(s) URL, or a same-origin
 * path this app serves.
 *
 * The second form is not a convenience — it is the ONLY form the uploader
 * produces. `POST /api/uploads` answers with
 * `{ url: "/uploads/avatar/2026/10/<uuid>.png" }`, so a plain
 * `z.string().url()` rejected every avatar and cover save with "Invalid URL"
 * the instant the upload succeeded. That made the whole feature look broken
 * even when the bytes had arrived safely.
 *
 * `//host` is refused on purpose: it is protocol-relative, so it reads like a
 * path while pointing at another origin.
 */
const imageRefSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (v) => {
      if (v.startsWith('//')) return false;
      if (v.startsWith('/')) return true;
      try {
        const protocol = new URL(v).protocol;
        return protocol === 'http:' || protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Must be an http(s) URL or a path starting with /' },
  );

// ─── Auth ───────────────────────────────────────────────────────────────────

export const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type SignupInput = z.infer<typeof signupSchema>;

// ─── OTP ────────────────────────────────────────────────────────────────────

/**
 * A one-time code, kept as a STRING so a leading zero is not eaten. As a number
 * `"012345"` becomes `12345`, which would reject a perfectly valid code for
 * roughly one user in ten.
 */
export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your email');

/** Opaque cuid. Only length-bounded here; existence is checked in the service. */
export const otpChallengeIdSchema = z.string().trim().min(8).max(64);

export const otpVerifySchema = z.object({
  challengeId: otpChallengeIdSchema,
  code: otpCodeSchema,
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

/**
 * The details an admin or manager supplies when creating somebody else's
 * account. Same shape for both flows — the difference is which role the
 * completed challenge grants, and that is decided server-side, never by the
 * client. There is deliberately no `role` field here: a member-creating form
 * that could ask for MANAGER would be a privilege-escalation surface.
 */
export const accountOtpRequestSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type AccountOtpRequestInput = z.infer<typeof accountOtpRequestSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

// ─── Users ──────────────────────────────────────────────────────────────────

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  bio: emptyToUndefined(z.string().max(280)),
  website: emptyToUndefined(z.string().url('Invalid URL').max(2048)),
  location: emptyToUndefined(z.string().max(60)),
  isPrivate: z.boolean().optional(),
  // Uploaded images, not links a user types — see imageRefSchema.
  avatarUrl: emptyToUndefined(imageRefSchema),
  coverUrl: emptyToUndefined(imageRefSchema),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const notificationPrefsSchema = z.object({
  likes: z.boolean().optional(),
  comments: z.boolean().optional(),
  follows: z.boolean().optional(),
  mentions: z.boolean().optional(),
  messages: z.boolean().optional(),
  invitations: z.boolean().optional(),
  announcements: z.boolean().optional(),
  calls: z.boolean().optional(),
  security: z.boolean().optional(),
});
export type NotificationPrefsInput = z.infer<typeof notificationPrefsSchema>;

// ─── Shared primitives (declared early: used by posts + conversations) ─────

export const messageAttachmentSchema = z.object({
  kind: z.enum(['IMAGE', 'VIDEO', 'FILE', 'VOICE']),
  url: z.string().trim().min(1).max(2000),
  name: z.string().trim().max(200).optional(),
  mimeType: z.string().trim().max(100).optional(),
  sizeBytes: z.number().int().nonnegative().max(500_000_000).optional(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
});
export type MessageAttachmentInput = z.infer<typeof messageAttachmentSchema>;

// ─── Posts ──────────────────────────────────────────────────────────────────

export const postVisibilitySchema = z.enum(['PUBLIC', 'FOLLOWERS', 'COMPANY', 'PRIVATE']);

export const postCreateSchema = z
  .object({
    body: z.string().trim().min(1, 'Post body is required').max(2000),
    visibility: postVisibilitySchema.default('PUBLIC'),
    companyId: cuidSchema.optional(),
    mediaIds: z.array(cuidSchema).max(4).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.visibility === 'COMPANY' && !data.companyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['companyId'],
        message: 'companyId is required for COMPANY visibility',
      });
    }
    if (data.visibility !== 'COMPANY' && data.companyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['companyId'],
        message: 'companyId is only valid for COMPANY visibility',
      });
    }
  });
export type PostCreateInput = z.infer<typeof postCreateSchema>;

export const postUpdateSchema = z.object({
  body: z.string().trim().min(1).max(2000).optional(),
  visibility: postVisibilitySchema.optional(),
});
export type PostUpdateInput = z.infer<typeof postUpdateSchema>;

// ─── Comments ───────────────────────────────────────────────────────────────

export const commentCreateSchema = z.object({
  body: z.string().trim().min(1, 'Comment body is required').max(1000),
  parentId: cuidSchema.nullish(),
});
export type CommentCreateInput = z.infer<typeof commentCreateSchema>;

export const commentUpdateSchema = z.object({
  body: z.string().trim().min(1).max(1000),
});

// ─── Reports ────────────────────────────────────────────────────────────────

export const reportCreateSchema = z.object({
  targetType: z.enum(['POST', 'COMMENT', 'MESSAGE', 'USER']),
  targetId: cuidSchema,
  reason: z.enum([
    'SPAM',
    'HARASSMENT',
    'HATE_SPEECH',
    'NUDITY_OR_SEXUAL',
    'VIOLENCE',
    'MISINFORMATION',
    'COPYRIGHT',
    'OTHER',
  ]),
  details: z.string().trim().max(1000).optional(),
});
export type ReportCreateInput = z.infer<typeof reportCreateSchema>;

// ─── Search / pagination ────────────────────────────────────────────────────

export const searchSchema = z.object({
  q: z.string().trim().min(1, 'Query is required').max(100),
  type: z.enum(['users', 'posts', 'hashtags', 'companies']).default('users'),
});

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const markNotificationsReadSchema = z.object({
  ids: z.array(cuidSchema).max(100).optional(),
});

// ─── Uploads ────────────────────────────────────────────────────────────────

export const uploadKindSchema = z.enum([
  'avatar',
  'cover',
  'post',
  'message',
  'voice',
  'company-logo',
]);
export type UploadKind = z.infer<typeof uploadKindSchema>;

// ─── Companies / teams / invitations (Backend Engineer B) ──────────────────

/**
 * Company roles that can be ASSIGNED.
 *
 * `OWNER` is deliberately absent (request 7): the product has exactly one kind
 * of company administrator — the Manager — and nobody is ever made an owner.
 * The Prisma enum keeps the OWNER value (dropping a value would be a
 * destructive migration for no functional gain), so a legacy row may still hold
 * it; that is a data fact, not something this API will ever accept again.
 *
 * Note what this schema does NOT decide: whether a COMPANY MANAGER is allowed
 * to hand out MANAGER. It allows it, because that is not a question about the
 * payload — it is a question about the caller, and the caller is only known once
 * the service has authorized them. `assertRoleAssignableByManager`
 * (lib/services/company-role-policy.ts) answers it, after `requireCompanyManager`
 * has run.
 *
 * Narrowing this enum to MEMBER was tried and reverted: validating before
 * authorizing meant an outsider probing another company's member endpoint got a
 * 400 describing the payload instead of the 403 they had earned, and it made the
 * `MANAGER_ROLE_ADMIN_ONLY` code unreachable — a generic "expected MEMBER" is a
 * worse message than "only an administrator can give someone the Manager role".
 */
export const companyRoleSchema = z.enum(['MANAGER', 'MEMBER']);
export const teamRoleSchema = z.enum(['MANAGER', 'MEMBER']);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Slug must be at least 3 characters')
  .max(40, 'Slug must be at most 40 characters')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug may contain lowercase letters, numbers and hyphens');

export const companyCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  slug: slugSchema.optional(),
  description: z.string().trim().max(1000).optional(),
  website: z.string().trim().max(200).optional(),
});
export type CompanyCreateInput = z.infer<typeof companyCreateSchema>;

export const companyUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    website: z.string().trim().max(200).nullable().optional(),
    logoUrl: z.string().trim().max(500).nullable().optional(),
    coverUrl: z.string().trim().max(500).nullable().optional(),
    brandColor: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Brand color must be a hex color like #84cc16')
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type CompanyUpdateInput = z.infer<typeof companyUpdateSchema>;

export const companyMemberAddSchema = z.object({
  userId: cuidSchema,
  role: companyRoleSchema.default('MEMBER'),
});
export type CompanyMemberAddInput = z.infer<typeof companyMemberAddSchema>;

export const companyMemberRoleSchema = z.object({
  role: companyRoleSchema,
});
export type CompanyMemberRoleInput = z.infer<typeof companyMemberRoleSchema>;

/** Manager-created account: user gets a secure temp password by email. */
export const companyAccountCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  username: usernameSchema,
  email: emailSchema,
  role: companyRoleSchema.default('MEMBER'),
});
export type CompanyAccountCreateInput = z.infer<typeof companyAccountCreateSchema>;

export const teamCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: z.string().trim().max(500).optional(),
});
export type TeamCreateInput = z.infer<typeof teamCreateSchema>;

export const teamUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type TeamUpdateInput = z.infer<typeof teamUpdateSchema>;

export const teamMemberAddSchema = z.object({
  userId: cuidSchema,
  role: teamRoleSchema.default('MEMBER'),
});
export type TeamMemberAddInput = z.infer<typeof teamMemberAddSchema>;

export const teamMemberRoleSchema = z.object({
  role: teamRoleSchema,
});
export type TeamMemberRoleInput = z.infer<typeof teamMemberRoleSchema>;

export const invitationCreateSchema = z.object({
  companyId: cuidSchema,
  email: emailSchema,
  role: companyRoleSchema.default('MEMBER'),
  teamId: cuidSchema.optional(),
});
export type InvitationCreateInput = z.infer<typeof invitationCreateSchema>;

export const announcementCreateSchema = z.object({
  body: z.string().trim().min(1, 'Body is required').max(2000),
});
export type AnnouncementCreateInput = z.infer<typeof announcementCreateSchema>;

export const joinRequestCreateSchema = z.object({
  message: z.string().trim().max(500).optional(),
});
export type JoinRequestCreateInput = z.infer<typeof joinRequestCreateSchema>;

export const joinRequestReviewSchema = z.object({
  action: z.enum(['APPROVE', 'DECLINE']),
});
export type JoinRequestReviewInput = z.infer<typeof joinRequestReviewSchema>;

/**
 * A request to become a company manager. Reviewed by a platform admin.
 *
 * The size fields default to 0 rather than being required: an applicant often
 * does not know the exact headcount, and a wrong-but-required number is worse
 * than an honest zero.
 */
export const managerApplicationSchema = z.object({
  /** Set when the applicant picked a company that is already on the platform. */
  companyId: cuidSchema.optional(),
  companyName: z.string().trim().min(2, 'Company name is required').max(120),
  position: z.string().trim().min(2, 'Your position is required').max(120),
  companySize: z.number().int().min(0).max(1_000_000).default(0),
  teamCount: z.number().int().min(0).max(10_000).default(0),
  teamSize: z.number().int().min(0).max(100_000).default(0),
  message: z.string().trim().max(1000).optional(),
});
export type ManagerApplicationInput = z.infer<typeof managerApplicationSchema>;

export const managerApplicationReviewSchema = z.object({
  action: z.enum(['APPROVE', 'DECLINE']),
  /**
   * Optional company to grant the role in. NOT required, and the admin UI no
   * longer sends it: a manager creates their own company. When omitted, the
   * service falls back to the company already attached to the application (set
   * when the applicant named one that exists).
   */
  companyId: cuidSchema.optional(),
  /**
   * MANAGER is the only grantable role. There is no owner to appoint — the
   * platform has exactly one administrator, and a company's top role is its
   * manager. Kept as an explicit field (rather than removed) so existing API
   * callers that send `role` keep working, and any attempt to send OWNER is
   * rejected with a validation error instead of silently granted.
   */
  role: z.literal('MANAGER').default('MANAGER'),
  note: z.string().trim().max(500).optional(),
});
export type ManagerApplicationReviewInput = z.infer<typeof managerApplicationReviewSchema>;

export const companyPostCreateSchema = z
  .object({
    body: z.string().trim().max(2000).optional(),
    visibility: z.enum(['COMPANY', 'PRIVATE']).default('COMPANY'),
    attachments: z.array(messageAttachmentSchema).max(10).optional(),
  })
  .refine((v) => v.body?.trim() || (v.attachments?.length ?? 0) > 0, {
    message: 'Post must have a body or attachments',
  });
export type CompanyPostCreateInput = z.infer<typeof companyPostCreateSchema>;

// ─── Conversations / messages (Backend Engineer B) ─────────────────────────

export const conversationCreateSchema = z.object({
  type: z.enum(['DM', 'GROUP']).default('GROUP'),
  userIds: z.array(cuidSchema).max(50).default([]),
  title: z.string().trim().max(80).optional(),
  companyId: cuidSchema.optional(),
});
export type ConversationCreateInput = z.infer<typeof conversationCreateSchema>;

export const conversationUpdateSchema = z
  .object({
    title: z.string().trim().max(80).nullable().optional(),
    avatarUrl: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type ConversationUpdateInput = z.infer<typeof conversationUpdateSchema>;

export const conversationMembersAddSchema = z.object({
  userIds: z.array(cuidSchema).min(1).max(50),
});
export type ConversationMembersAddInput = z.infer<typeof conversationMembersAddSchema>;

const emojiSchema = z
  .string()
  .min(1)
  .max(16)
  .regex(/\p{Extended_Pictographic}/u, 'Must be an emoji');

export const voiceMessageSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  durationSeconds: z.number().int().min(1).max(600),
  waveform: z.array(z.number().min(0).max(1)).max(200).optional(),
  mimeType: z.string().trim().max(100).optional(),
  sizeBytes: z.number().int().nonnegative().max(50_000_000).optional(),
});
export type VoiceMessageInput = z.infer<typeof voiceMessageSchema>;

export const messageCreateSchema = z
  .object({
    body: z.string().trim().max(4000).optional(),
    type: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'FILE', 'VOICE']).default('TEXT'),
    attachments: z.array(messageAttachmentSchema).max(10).optional(),
    /** Ids of existing attachments to copy onto this message (forwarding). */
    attachmentIds: z.array(cuidSchema).max(10).optional(),
    voice: voiceMessageSchema.optional(),
    /** Idempotency key (ARCHITECTURE.md §3 — dedupe retries). */
    clientId: z.string().trim().min(1).max(100).optional(),
    /** Message being replied to. Must be in the same conversation. */
    replyToId: cuidSchema.optional(),
    /** Original message when this send is a forward. May be in another conversation. */
    forwardedFromId: cuidSchema.optional(),
  })
  .refine((v) => v.body?.trim() || (v.attachments?.length ?? 0) > 0 || (v.attachmentIds?.length ?? 0) > 0 || v.voice, {
    message: 'Message must have a body, attachments, or voice',
  });
export type MessageCreateInput = z.infer<typeof messageCreateSchema>;

export const messageForwardSchema = z.object({
  conversationId: cuidSchema,
  /** Optional note prepended to the forwarded content. */
  note: z.string().trim().max(4000).optional(),
});
export type MessageForwardInput = z.infer<typeof messageForwardSchema>;

export const messageUpdateSchema = z.object({
  body: z.string().trim().min(1, 'Body is required').max(4000),
});
export type MessageUpdateInput = z.infer<typeof messageUpdateSchema>;

export const reactionToggleSchema = z.object({ emoji: emojiSchema });
export type ReactionToggleInput = z.infer<typeof reactionToggleSchema>;

export const conversationReadSchema = z.object({
  messageId: cuidSchema.optional(),
});
export type ConversationReadInput = z.infer<typeof conversationReadSchema>;

export const conversationMuteSchema = z.object({
  muted: z.boolean(),
});
export type ConversationMuteInput = z.infer<typeof conversationMuteSchema>;

/**
 * Body of `POST /api/presence`.
 *
 * Mirrors `PresenceUpdateSchema` in `lib/realtime/events.ts`, minus `OFFLINE`:
 * a client may never declare itself offline, because offline is what the
 * server decides when a client stops beating. An omitted status is a
 * heartbeat — touch `lastSeenAt`, keep the current status.
 */
export const presenceUpdateSchema = z.object({
  status: z.enum(['ONLINE', 'AWAY', 'DO_NOT_DISTURB']).optional(),
});
export type PresenceUpdateInput = z.infer<typeof presenceUpdateSchema>;

// ─── Calls (Backend Engineer B) ─────────────────────────────────────────────

export const callCreateSchema = z.object({
  conversationId: cuidSchema.optional(),
  userIds: z.array(cuidSchema).max(6).default([]),
  type: z.enum(['AUDIO', 'VIDEO']),
});
export type CallCreateInput = z.infer<typeof callCreateSchema>;

export const callTransitionSchema = z.object({
  action: z.enum(['accept', 'decline', 'end']),
});
export type CallTransitionInput = z.infer<typeof callTransitionSchema>;

// ─── Admin (Backend Engineer B) ─────────────────────────────────────────────

export const adminUserUpdateSchema = z
  .object({
    isActive: z.boolean().optional(),
    platformRole: z.enum(['USER', 'ADMIN', 'SUPER_ADMIN']).optional(),
    /**
     * Platform "verified" badge (`User.isVerified`) — cosmetic.
     *
     * NOT the same thing as `emailVerifiedAt`: a user who never received the
     * verification mail cannot sign in, and this flag does not change that.
     */
    isVerified: z.boolean().optional(),
    /**
     * Email verification. `null` clears it, an ISO timestamp marks the address
     * verified. This is the flag that gates sign-in, so it is the one an admin
     * needs when a user is locked out — before this existed, the admin console
     * offered a button labelled "Email verified" that silently wrote the
     * cosmetic badge instead, leaving the account still unable to log in.
     */
    emailVerifiedAt: z.string().datetime().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type AdminUserUpdateInput = z.infer<typeof adminUserUpdateSchema>;

export const adminCompanyUpdateSchema = z
  .object({
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type AdminCompanyUpdateInput = z.infer<typeof adminCompanyUpdateSchema>;

/**
 * Admin panel only: grant or revoke the Manager role inside one company.
 *
 * This is the ONLY path that can create a company manager (part 2, request 3).
 * `companyRoleSchema` allows MANAGER and MEMBER and still refuses OWNER, so an
 * admin can promote and demote but cannot mint an owner.
 */
export const adminCompanyMemberRoleSchema = z.object({
  role: companyRoleSchema,
});
export type AdminCompanyMemberRoleInput = z.infer<typeof adminCompanyMemberRoleSchema>;

export const reportResolveSchema = z.object({
  status: z.enum(['IN_REVIEW', 'ACTIONED', 'DISMISSED']),
  action: z.enum(['dismiss', 'delete_content', 'suspend_user']).optional(),
});
export type ReportResolveInput = z.infer<typeof reportResolveSchema>;

export const moderationActionSchema = z.object({
  action: z.enum(['delete_post', 'delete_comment', 'delete_message', 'suspend_user']),
  targetType: z.enum(['POST', 'COMMENT', 'MESSAGE', 'USER']),
  targetId: cuidSchema,
  reason: z.string().trim().max(500).optional(),
});
export type ModerationActionInput = z.infer<typeof moderationActionSchema>;

export const systemSettingSchema = z.object({
  key: z.string().trim().min(1).max(100).regex(/^[a-z0-9._-]+$/i, 'Invalid setting key'),
  value: z.unknown(),
});
export type SystemSettingInput = z.infer<typeof systemSettingSchema>;

export const adminAnnouncementCreateSchema = z.object({
  body: z.string().trim().min(1, 'Body is required').max(2000),
  title: z.string().trim().max(120).optional(),
});
export type AdminAnnouncementCreateInput = z.infer<typeof adminAnnouncementCreateSchema>;
