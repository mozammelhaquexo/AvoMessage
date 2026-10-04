/**
 * lib/services/companies.ts — company domain logic (Backend Engineer B).
 *
 * Thin route handlers call these; ALL authorization lives here (defense in
 * depth for socket/cron reuse). Every query is scoped by membership — company
 * data never leaks to non-members. Mutations write audit log rows.
 */
import { prisma } from "@/lib/db";

/** Typed DB facade (pre-generation stand-in; real client later). */
const db = prisma as unknown as PrismaClientLike;
import {
  ConflictError,
  EmailUnverifiedError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/api";
import {
  getCompanyMembership,
  requireCompanyManager,
  requireCompanyMember,
} from "@/lib/permissions";
import { COMPANY_ADMIN_ROLES, isCompanyManagerRole } from "@/lib/company-roles";
import { assertRoleAssignableByManager } from "./company-role-policy";
import { isPlatformAdminRole } from "@/lib/services/platform-admin-policy";
import {
  assertCanCreateCompany,
  assertMembershipCapacity,
  canCreateCompany,
  membershipLimitFor,
  tierFor,
  type MemberTier,
} from "./company-membership-policy";
import {
  OtpPurpose,
  assertPurpose,
  consumeOtpChallenge,
  issueOtpChallenge,
  otpRequestWire,
  sendOtpEmail,
  verifyOtpCode,
  type OtpRequestResult,
} from "@/lib/services/otp";
import { hashPassword } from "@/lib/auth/password";
import { writeAuditLog } from "@/lib/audit";
import { getMailer } from "@/lib/mailer";
import { decodeCursor, encodeCursor } from "@/lib/api";
import type {
  Actor,
  Company,
  CompanyRole,
  CompanyMember,
  CompanyMemberWithCompany,
  CompanyMemberWithUser,
  CompanyJoinRequestWithUser,
  AuditLogWithActor,
  JoinRequestStatus,
  PrismaClientLike,
  User,
} from "@/lib/prisma-types";
import {
  companyMemberView,
  publicCompany,
  publicUser,
  type PublicUser,
} from "./serialize";
import {
  postFeedInclude,
  serializePostWithViewerState,
  type PostWithIncludes,
  type SerializedPost,
} from "./posts";
import type {
  AccountOtpRequestInput,
  CompanyAccountCreateInput,
  CompanyCreateInput,
  CompanyMemberAddInput,
  CompanyMemberRoleInput,
  CompanyPostCreateInput,
  CompanyUpdateInput,
  AnnouncementCreateInput,
  JoinRequestCreateInput,
  JoinRequestReviewInput,
} from "@/lib/validation";

export interface PageOpts {
  limit: number;
  cursor: string | null;
}

interface MutationCtx {
  ip?: string | null;
}

/** Load a company or throw 404. Inactive companies are invisible to members. */
async function getActiveCompany(companyId: string): Promise<Company> {
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company || !company.isActive) {
    throw new NotFoundError("Company not found");
  }
  return company;
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s.length >= 3 ? s : "company";
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 2;
  // biome-ignore lint: bounded loop, slug space is finite
  while (await db.company.findFirst({ where: { slug } })) {
    slug = `${base}-${n++}`;
    if (n > 1000) throw new ConflictError("CONFLICT", "Could not generate a unique slug");
  }
  return slug;
}

/** Cursor → Prisma where fragment for (createdAt DESC, id DESC) paging. */
function cursorFragment(cursor: string | null): Record<string, unknown>[] {
  if (!cursor) return [];
  const { createdAt, id } = decodeCursor(cursor);
  return [
    {
      OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
    },
  ];
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * The viewer's membership for a company slug, or null.
 *
 * Exists for SERVER-SIDE route guards: `app/(app)/manage/[slug]/layout.tsx`
 * needs the role before it renders anything, and the client-side check in
 * `ManageShell` runs too late to stop privileged markup being sent.
 */
export async function getMembershipBySlug(
  actor: Actor,
  slug: string
): Promise<{ companyId: string; role: CompanyRole } | null> {
  const company = await db.company.findFirst<Company>({ where: { slug, isActive: true } });
  if (!company) return null;
  const membership = await db.companyMember.findUnique<CompanyMember>({
    where: { companyId_userId: { companyId: company.id, userId: actor.id } },
  });
  if (!membership) return null;
  return { companyId: company.id, role: membership.role };
}

export async function listMyCompanies(actor: Actor) {
  const memberships = await db.companyMember.findMany<CompanyMemberWithCompany>({
    where: { userId: actor.id },
    include: { company: true },
    orderBy: { joinedAt: "desc" },
  });
  return memberships
    .filter((m) => m.company.isActive)
    .map((m) => ({
      company: publicCompany(m.company),
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    }));
}

export async function getCompany(actor: Actor, companyId: string) {
  const membership = await requireCompanyMember(actor.id, companyId);
  const company = await getActiveCompany(companyId);
  const [memberCount, teamCount, postCount] = await Promise.all([
    db.companyMember.count({ where: { companyId } }),
    db.team.count({ where: { companyId } }),
    db.post.count({ where: { companyId, deletedAt: null } }),
  ]);
  return {
    company: publicCompany(company),
    viewerRole: membership.role,
    counts: { members: memberCount, teams: teamCount, posts: postCount },
  };
}

export async function listMembers(actor: Actor, companyId: string, opts: PageOpts) {
  await requireCompanyMember(actor.id, companyId);
  await getActiveCompany(companyId);
  // Page on (joinedAt DESC, userId DESC); cursor carries joinedAt|userId.
  let cursorCond: Record<string, unknown> | null = null;
  if (opts.cursor) {
    try {
      const raw = JSON.parse(Buffer.from(opts.cursor, "base64url").toString("utf8")) as {
        c: string;
        i: string;
      };
      const joinedAt = new Date(raw.c);
      if (!Number.isNaN(joinedAt.getTime()) && raw.i) {
        cursorCond = {
          OR: [{ joinedAt: { lt: joinedAt } }, { joinedAt, userId: { lt: raw.i } }],
        };
      }
    } catch {
      throw new ConflictError("INVALID_CURSOR", "Invalid cursor");
    }
  }
  const members = await db.companyMember.findMany<CompanyMemberWithUser>({
    where: cursorCond ? { companyId, AND: [cursorCond] } : { companyId },
    include: { user: true },
    orderBy: [{ joinedAt: "desc" }, { userId: "desc" }],
    take: opts.limit + 1,
  });
  const page = members.slice(0, opts.limit);
  const nextCursor =
    members.length > opts.limit
      ? Buffer.from(
          JSON.stringify({
            c: page[page.length - 1].joinedAt.toISOString(),
            i: page[page.length - 1].userId,
          })
        ).toString("base64url")
      : null;
  return {
    data: page.map(companyMemberView),
    nextCursor,
  };
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * How many companies this person already belongs to.
 *
 * Every membership row counts, including the ones that make them a manager of
 * that company — the cap is on companies, not on roles.
 */
export async function countMemberships(userId: string): Promise<number> {
  return db.companyMember.count({ where: { userId } });
}

/**
 * Which tier this person is in, for the membership cap.
 *
 * "Is a manager" is read from two places, because the platform records it in
 * two places and either one alone is wrong:
 *
 *   1. a MANAGER (or legacy OWNER) `CompanyMember` row — see
 *      lib/company-roles.ts for why OWNER still appears on old rows;
 *   2. an APPROVED `ManagerApplication`.
 *
 * (2) is not belt-and-braces, it is what stops a deadlock. Approval is
 * deliberately allowed with no company attached (part 2, request 4: "a manager
 * creates their own company"), and the approval notification literally says
 * "You're approved as a manager. Create your company to open the Manager
 * Panel." A manager approved that way has no company, therefore no company
 * role, therefore — if (1) were the only source — tier USER, which
 * `assertCanCreateCompany` refuses. The one instruction the platform gives them
 * would be the one thing they are forbidden to do.
 *
 * ADMIN short-circuits before either query, so an administrator costs nothing.
 * The two counts run in parallel and both hit an index (`CompanyMember` on
 * `userId`, `ManagerApplication` on `[userId, status]`).
 */
export async function resolveMemberTier(
  userId: string,
  platformRole: string
): Promise<MemberTier> {
  if (isPlatformAdminRole(platformRole)) return "ADMIN";
  const [manages, approved] = await Promise.all([
    db.companyMember.count({
      where: { userId, role: { in: [...COMPANY_ADMIN_ROLES] } },
    }),
    db.managerApplication.count({ where: { userId, status: "APPROVED" } }),
  ]);
  return tierFor(platformRole, manages > 0 || approved > 0);
}

/**
 * The cap check for putting an *existing* person into another company.
 *
 * Both facts — the tier and the current count — are read here rather than taken
 * from the caller, so all eight call sites cannot drift apart, and a caller
 * cannot accidentally pass a count it took before another write.
 */
export async function assertRoomForAnotherCompany(
  userId: string,
  platformRole: string,
  subject: "self" | "other" = "self"
): Promise<void> {
  const tier = await resolveMemberTier(userId, platformRole);
  assertMembershipCapacity(tier, await countMemberships(userId), subject);
}

/**
 * Everything the UI needs to decide what to offer: which tier the viewer is in,
 * how much room is left, and whether the create button belongs on the page.
 *
 * This exists so the client never re-derives the rule. A client-side guess at
 * "am I a manager?" would be wrong for exactly the person it matters most to —
 * an approved manager with no company yet holds no company role, so any check
 * based on memberships would hide the create button from the one person who is
 * supposed to press it. The answer comes from the same functions that enforce
 * it, and the page shell (a Server Component) computes it before the first
 * paint, so there is no flash of a button that would 403.
 */
export interface MembershipStatus {
  tier: MemberTier;
  /** `null` = unlimited. */
  limit: number | null;
  /** Companies the viewer belongs to right now. */
  current: number;
  canCreateCompany: boolean;
}

export async function membershipStatusFor(
  userId: string,
  platformRole: string
): Promise<MembershipStatus> {
  const [tier, current] = await Promise.all([
    resolveMemberTier(userId, platformRole),
    countMemberships(userId),
  ]);
  return {
    tier,
    limit: membershipLimitFor(tier),
    current,
    canCreateCompany: canCreateCompany(tier),
  };
}

export async function createCompany(actor: Actor, input: CompanyCreateInput, ctx: MutationCtx = {}) {
  // Nobody below manager may create a company. This is not only the product
  // rule — it is what keeps the membership cap honest: the creator becomes a
  // MANAGER of the new company, so if a plain user could call this, the USER
  // tier would have a one-step route around its own limit of one.
  const tier = await resolveMemberTier(actor.id, actor.platformRole);
  assertCanCreateCompany(tier);
  assertMembershipCapacity(tier, await countMemberships(actor.id), "self");

  const slug = await uniqueSlug(input.slug ?? slugify(input.name));
  const company = await db.$transaction(async (tx) => {
    const created = await tx.company.create({
      data: {
        name: input.name,
        slug,
        description: input.description ?? null,
        website: input.website ?? null,
        // `ownerId` is a required column and stays the "created by" pointer.
        // It is NOT a role: nobody is ever an owner (request 7).
        ownerId: actor.id,
      },
    });
    // The creator administers the company as a MANAGER. Never OWNER — see
    // lib/company-roles.ts for why the owner role is retired from the product.
    await tx.companyMember.create({
      data: { companyId: created.id, userId: actor.id, role: "MANAGER" },
    });
    return created;
  });
  await writeAuditLog({
    actorId: actor.id,
    action: "company.create",
    entityType: "company",
    entityId: company.id,
    metadata: { name: company.name, slug },
    ipAddress: ctx.ip,
  });
  return { company: publicCompany(company), viewerRole: "MANAGER" as CompanyRole };
}

export async function updateCompany(
  actor: Actor,
  companyId: string,
  input: CompanyUpdateInput,
  ctx: MutationCtx = {}
) {
  await requireCompanyManager(actor.id, companyId);
  const company = await getActiveCompany(companyId);
  const updated = await db.company.update({
    where: { id: company.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.website !== undefined ? { website: input.website } : {}),
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      ...(input.coverUrl !== undefined ? { coverUrl: input.coverUrl } : {}),
      ...(input.brandColor !== undefined ? { brandColor: input.brandColor } : {}),
    },
  });
  await writeAuditLog({
    actorId: actor.id,
    action: "company.update",
    entityType: "company",
    entityId: company.id,
    metadata: { fields: Object.keys(input) },
    ipAddress: ctx.ip,
  });
  return { company: publicCompany(updated) };
}

/**
 * Soft deactivation by the company's own administrator. Members see the company
 * as gone afterwards. A platform admin can do this too (and undo it) from the
 * admin console.
 *
 * Gated on MANAGER rather than OWNER: no company created under the current
 * rules has an owner, so an owner-only check would make this unreachable.
 */
export async function deactivateCompany(actor: Actor, companyId: string, ctx: MutationCtx = {}) {
  await requireCompanyManager(actor.id, companyId);
  const company = await getActiveCompany(companyId);
  await db.company.update({ where: { id: company.id }, data: { isActive: false } });
  await writeAuditLog({
    actorId: actor.id,
    action: "company.deactivate",
    entityType: "company",
    entityId: company.id,
    metadata: {},
    ipAddress: ctx.ip,
  });
  return { ok: true as const };
}

async function getTargetUser(userId: string): Promise<User> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt || !user.isActive) {
    throw new NotFoundError("User not found");
  }
  return user;
}

export async function addMember(
  actor: Actor,
  companyId: string,
  input: CompanyMemberAddInput,
  ctx: MutationCtx = {}
) {
  await requireCompanyManager(actor.id, companyId);
  await getActiveCompany(companyId);
  // A manager may add MEMBERS only — never a peer, never an owner. See
  // lib/services/company-role-policy.ts.
  assertRoleAssignableByManager(input.role);
  const target = await getTargetUser(input.userId);
  const existing = await getCompanyMembership(target.id, companyId);
  if (existing) {
    throw new ConflictError("ALREADY_MEMBER", "User is already a member of this company");
  }
  // The cap is on the person being added, not on the manager doing the adding:
  // a manager with room cannot push somebody else past their own limit.
  await assertRoomForAnotherCompany(target.id, target.platformRole, "other");
  const created = await db.companyMember.create<CompanyMemberWithUser>({
    data: { companyId, userId: target.id, role: input.role },
    include: { user: true },
  });
  await writeAuditLog({
    actorId: actor.id,
    action: "company.member_add",
    entityType: "company",
    entityId: companyId,
    metadata: { targetUserId: target.id, role: input.role },
    ipAddress: ctx.ip,
  });
  return companyMemberView(created);
}

export async function updateMemberRole(
  actor: Actor,
  companyId: string,
  targetUserId: string,
  input: CompanyMemberRoleInput,
  ctx: MutationCtx = {}
) {
  const membership = await requireCompanyManager(actor.id, companyId);
  await getActiveCompany(companyId);
  const target = await db.companyMember.findUnique<CompanyMemberWithUser>({
    where: { companyId_userId: { companyId, userId: targetUserId } },
    include: { user: true },
  });
  if (!target) throw new NotFoundError("Membership not found");

  // The only role a company-side caller can set is MEMBER: no owner, and no
  // promotion to manager (that happens in the admin console). See
  // lib/services/company-role-policy.ts.
  assertRoleAssignableByManager(input.role);

  const isOwnerActor = membership.role === "OWNER";
  // Managers may never touch a legacy owner row.
  if (!isOwnerActor) {
    if (target.role === "OWNER") {
      throw new ForbiddenError("FORBIDDEN", "Managers cannot change owner roles");
    }
  }
  if (target.role === input.role) return companyMemberView(target);

  // Invariant: a company always keeps at least one administrator. Demoting the
  // last manager (or a legacy owner) to MEMBER would leave it unmanaged, and
  // only a platform admin could put it right.
  if (isCompanyManagerRole(target.role) && !isCompanyManagerRole(input.role)) {
    const admins = await db.companyMember.count({
      where: { companyId, role: { in: COMPANY_ADMIN_ROLES } },
    });
    if (admins <= 1) {
      throw new ConflictError("LAST_MANAGER", "A company must keep at least one manager");
    }
  }

  const updated = await db.companyMember.update<CompanyMemberWithUser>({
    where: { companyId_userId: { companyId, userId: targetUserId } },
    data: { role: input.role },
    include: { user: true },
  });
  await writeAuditLog({
    actorId: actor.id,
    action: "company.member_role_change",
    entityType: "company",
    entityId: companyId,
    metadata: { targetUserId, from: target.role, to: input.role },
    ipAddress: ctx.ip,
  });
  return companyMemberView(updated);
}

export async function removeMember(
  actor: Actor,
  companyId: string,
  targetUserId: string,
  ctx: MutationCtx = {}
) {
  await getActiveCompany(companyId);
  const target = await db.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId: targetUserId } },
  });
  if (!target) throw new NotFoundError("Membership not found");

  const selfLeave = actor.id === targetUserId;
  if (!selfLeave) {
    const membership = await requireCompanyManager(actor.id, companyId);
    const isOwnerActor = membership.role === "OWNER";
    // Managers cannot remove owners or other managers.
    if (!isOwnerActor && target.role !== "MEMBER") {
      throw new ForbiddenError("FORBIDDEN", "Managers cannot remove owners or managers");
    }
  }

  // Invariant: the last administrator cannot leave or be removed. "Administrator"
  // is manager-or-owner, because a legacy OWNER row is still an administrator.
  if (isCompanyManagerRole(target.role)) {
    const admins = await db.companyMember.count({
      where: { companyId, role: { in: COMPANY_ADMIN_ROLES } },
    });
    if (admins <= 1) {
      throw new ConflictError(
        "LAST_MANAGER",
        "The last manager cannot leave; add another manager first"
      );
    }
  }

  await db.$transaction(async (tx) => {
    // Leave teams in this company.
    const teams = await tx.team.findMany({ where: { companyId }, select: { id: true } });
    if (teams.length > 0) {
      await tx.teamMember.deleteMany({
        where: { userId: targetUserId, teamId: { in: teams.map((t) => t.id) } },
      });
    }
    // Leave company-linked group conversations (DMs are untouched).
    const convos = await tx.conversation.findMany({
      where: { companyId, type: "GROUP" },
      select: { id: true },
    });
    if (convos.length > 0) {
      await tx.conversationMember.deleteMany({
        where: { userId: targetUserId, conversationId: { in: convos.map((c) => c.id) } },
      });
    }
    await tx.companyMember.delete({
      where: { companyId_userId: { companyId, userId: targetUserId } },
    });
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "company.member_remove",
    entityType: "company",
    entityId: companyId,
    metadata: { targetUserId, selfLeave, role: target.role },
    ipAddress: ctx.ip,
  });
  return { ok: true as const };
}

/**
 * Manager-created account. A secure random temp password is generated, bcrypt-
 * hashed (cost 12), and emailed to the new user — it is NEVER returned in the
 * response, logged, or stored in plaintext.
 *
 * SCHEMA GAP (documented): `User` has no `mustResetPassword` flag, so the
 * first-login forced reset cannot be enforced until the column is added (see
 * report). The welcome email instructs the user to change it immediately.
 */
export async function createMemberAccount(
  actor: Actor,
  companyId: string,
  input: CompanyAccountCreateInput,
  ctx: MutationCtx = {}
) {
  await requireCompanyManager(actor.id, companyId);
  const company = await getActiveCompany(companyId);
  // A manager-created account joins as a MEMBER — never a manager, never an
  // owner. See lib/services/company-role-policy.ts.
  assertRoleAssignableByManager(input.role);

  const emailTaken = await db.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });
  if (emailTaken) throw new ConflictError("EMAIL_TAKEN", "Email is already registered");
  const usernameTaken = await db.user.findUnique({ where: { username: input.username } });
  if (usernameTaken) throw new ConflictError("USERNAME_TAKEN", "Username is already taken");

  // Secure random temp password — never logged, never returned.
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: input.email.toLowerCase(),
        passwordHash,
        name: input.name,
        username: input.username,
        // The manager asserted this email and the temp password is delivered
        // to it; treat as verified so the user can sign in immediately.
        emailVerifiedAt: new Date(),
      },
    });
    // No capacity check here, deliberately: `created` was made in this same
    // transaction, so this is its first membership by construction. A check
    // would be a branch that can never be reached. The cap still binds the
    // person on every LATER add — see assertRoomForAnotherCompany.
    await tx.companyMember.create({
      data: { companyId, userId: created.id, role: input.role },
    });
    return created;
  });

  let emailSent = true;
  try {
    await getMailer().send({
      to: user.email,
      subject: `Your AvoMessage account for ${company.name}`,
      html: `<p>Hi ${escapeHtml(user.name)},</p><p>An account was created for you at <strong>${escapeHtml(company.name)}</strong> on AvoMessage.</p><p>Your temporary password is: <code>${escapeHtml(tempPassword)}</code></p><p>Please sign in and change it immediately.</p>`,
      text: `Hi ${user.name},\n\nAn account was created for you at ${company.name} on AvoMessage.\n\nYour temporary password is: ${tempPassword}\n\nPlease sign in and change it immediately.`,
      tag: "account-created",
    });
  } catch (e) {
    emailSent = false;
    console.error("[companies] failed to send temp-password email", e);
  }

  await writeAuditLog({
    actorId: actor.id,
    action: "company.account_create",
    entityType: "company",
    entityId: companyId,
    // NEVER include the password (not even hashed) in audit metadata.
    metadata: { targetUserId: user.id, email: user.email, role: input.role, emailSent },
    ipAddress: ctx.ip,
  });

  return { user: publicUser(user), emailSent };
}

function generateTempPassword(length = 16): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const bytes: Buffer = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// ─── OTP-gated member creation ──────────────────────────────────────────────
//
// The flow the manager panel uses: the manager fills in the new member's email
// and a password, and the ACCOUNT IS NOT CREATED until that address confirms a
// code. Compare `createMemberAccount` above, which creates the row immediately
// and mails a temp password — that path trusts the manager's typing of somebody
// else's address, which is the thing OTP exists to stop.

export async function requestMemberAccountOtp(
  actor: Actor,
  companyId: string,
  input: AccountOtpRequestInput,
  ctx: MutationCtx = {}
): Promise<OtpRequestResult> {
  await requireCompanyManager(actor.id, companyId);
  const company = await getActiveCompany(companyId);

  // A manager can only ever create a MEMBER here. The role is a constant, not a
  // field of the request — see lib/services/company-role-policy.ts for why the
  // MANAGER role has exactly one door and it is not this one.
  assertRoleAssignableByManager("MEMBER");

  const email = input.email.toLowerCase().trim();
  const emailTaken = await db.user.findUnique({ where: { email } });
  if (emailTaken) throw new ConflictError("EMAIL_TAKEN", "Email is already registered");
  const usernameTaken = await db.user.findUnique({ where: { username: input.username } });
  if (usernameTaken) throw new ConflictError("USERNAME_TAKEN", "Username is already taken");

  // Hash now, park the hash. The plaintext the manager typed is discarded at
  // the edge of this request and never held in a pending row.
  const passwordHash = await hashPassword(input.password);

  const issued = await issueOtpChallenge({
    purpose: OtpPurpose.COMPANY_MEMBER,
    email,
    payload: {
      companyId,
      name: input.name.trim(),
      username: input.username,
      email,
      passwordHash,
    },
    createdById: actor.id,
  });

  await sendOtpEmail({
    to: email,
    name: input.name,
    code: issued.code,
    purpose: "COMPANY_MEMBER",
    companyName: company.name,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "company.account_otp_sent",
    entityType: "company",
    entityId: companyId,
    metadata: { email, role: "MEMBER" },
    ipAddress: ctx.ip,
  });

  return otpRequestWire(issued, email);
}

export interface MemberAccountCreated {
  user: PublicUser;
  companyId: string;
  role: CompanyRole;
}

export async function completeMemberAccountOtp(
  actor: Actor,
  challengeId: string,
  code: string,
  ctx: MutationCtx = {}
): Promise<MemberAccountCreated> {
  const challenge = await verifyOtpCode(challengeId, code);
  assertPurpose(challenge, OtpPurpose.COMPANY_MEMBER);

  const payload = challenge.payload as {
    companyId: string;
    name: string;
    username: string;
    email: string;
    passwordHash: string;
  };

  // Authorization is re-decided HERE, not inherited from the request step. The
  // code was in flight for up to ten minutes; a manager demoted in the meantime
  // must not be able to finish what they started. `requireCompanyManager` reads
  // the database now, which is the only fact that counts.
  await requireCompanyManager(actor.id, payload.companyId);
  await getActiveCompany(payload.companyId);

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: payload.email,
        passwordHash: payload.passwordHash,
        name: payload.name,
        username: payload.username,
        // The code went to this address and came back from it. That is the
        // whole point of the flow, so the account starts verified.
        emailVerifiedAt: new Date(),
      },
    });
    // No capacity check: `created` is new in this transaction, so this is its
    // first membership by construction (see the note on the legacy
    // createMemberAccount path above).
    await tx.companyMember.create({
      data: { companyId: payload.companyId, userId: created.id, role: "MEMBER" },
    });
    return created;
  });

  await consumeOtpChallenge(challenge.id);

  await writeAuditLog({
    actorId: actor.id,
    action: "company.account_create",
    entityType: "company",
    entityId: payload.companyId,
    // NEVER the password, not even hashed.
    metadata: { targetUserId: user.id, email: user.email, role: "MEMBER", via: "otp" },
    ipAddress: ctx.ip,
  });

  return { user: publicUser(user), companyId: payload.companyId, role: "MEMBER" };
}


function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ─── Company feed / announcements / activity ───────────────────────────────

export async function listCompanyPosts(actor: Actor, companyId: string, opts: PageOpts) {
  await requireCompanyMember(actor.id, companyId);
  await getActiveCompany(companyId);
  const where = {
    companyId,
    deletedAt: null,
    AND: [
      // Members see everything except other members' PRIVATE posts.
      { OR: [{ visibility: { not: "PRIVATE" } }, { authorId: actor.id }] },
      ...cursorFragment(opts.cursor),
    ],
  };
  const posts = await db.post.findMany<PostWithIncludes>({
    where,
    include: postFeedInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
  });
  const page = posts.slice(0, opts.limit);
  const nextCursor =
    posts.length > opts.limit
      ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id)
      : null;

  // Batch viewer state (one query each, not N+1).
  const ids = page.map((p) => p.id);
  const [likes, bookmarks] = await Promise.all([
    ids.length
      ? db.like.findMany({ where: { userId: actor.id, postId: { in: ids } }, select: { postId: true } })
      : Promise.resolve([]),
    ids.length
      ? db.bookmark.findMany({ where: { userId: actor.id, postId: { in: ids } }, select: { postId: true } })
      : Promise.resolve([]),
  ]);
  const liked = new Set(likes.map((l: { postId: string }) => l.postId));
  const bookmarked = new Set(bookmarks.map((b: { postId: string }) => b.postId));

  // Canonical SerializedPost shape — same contract as the World feed, so the
  // frontend needs no adapter shim.
  const data: SerializedPost[] = page.map((p) =>
    serializePostWithViewerState(p, {
      liked: liked.has(p.id),
      bookmarked: bookmarked.has(p.id),
    })
  );

  return { data, nextCursor };
}

/**
 * Company announcements: COMPANY-visibility posts authored by the company's
 * owners/managers. Backed by posts (schema has no Announcement model) —
 * POST is manager+ only.
 */
export async function listAnnouncements(actor: Actor, companyId: string, opts: PageOpts) {
  await requireCompanyMember(actor.id, companyId);
  await getActiveCompany(companyId);
  const managers = await db.companyMember.findMany({
    where: { companyId, role: { in: ["MANAGER", "OWNER"] } },
    select: { userId: true },
  });
  const managerIds = managers.map((m) => m.userId);
  const posts = await db.post.findMany<PostWithIncludes>({
    where: {
      companyId,
      visibility: "COMPANY",
      deletedAt: null,
      authorId: { in: managerIds },
      AND: cursorFragment(opts.cursor),
    },
    include: postFeedInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
  });
  const page = posts.slice(0, opts.limit);

  // Batch viewer state (one query each, not N+1).
  const ids = page.map((p) => p.id);
  const [likes, bookmarks] = await Promise.all([
    ids.length
      ? db.like.findMany({ where: { userId: actor.id, postId: { in: ids } }, select: { postId: true } })
      : Promise.resolve([]),
    ids.length
      ? db.bookmark.findMany({ where: { userId: actor.id, postId: { in: ids } }, select: { postId: true } })
      : Promise.resolve([]),
  ]);
  const liked = new Set(likes.map((l: { postId: string }) => l.postId));
  const bookmarked = new Set(bookmarks.map((b: { postId: string }) => b.postId));

  return {
    data: page.map((p) =>
      serializePostWithViewerState(p, {
        liked: liked.has(p.id),
        bookmarked: bookmarked.has(p.id),
      })
    ),
    nextCursor:
      posts.length > opts.limit
        ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id)
        : null,
  };
}

export async function createAnnouncement(
  actor: Actor,
  companyId: string,
  input: AnnouncementCreateInput,
  ctx: MutationCtx = {}
) {
  await requireCompanyManager(actor.id, companyId);
  if (!actor.emailVerifiedAt) throw new EmailUnverifiedError();
  const company = await getActiveCompany(companyId);
  const post = await db.post.create<PostWithIncludes>({
    data: {
      authorId: actor.id,
      body: input.body,
      visibility: "COMPANY",
      companyId: company.id,
    },
    include: postFeedInclude,
  });
  await writeAuditLog({
    actorId: actor.id,
    action: "company.announcement_create",
    entityType: "company",
    entityId: company.id,
    metadata: { postId: post.id },
    ipAddress: ctx.ip,
  });
  return serializePostWithViewerState(post, { liked: false, bookmarked: false });
}

/**
 * Member post to the company feed. Members post with COMPANY visibility;
 * PRIVATE keeps the post visible to the author only (enforced in
 * listCompanyPosts). Requires verified email, matching message-send rules.
 */
export async function createCompanyPost(
  actor: Actor,
  companyId: string,
  input: CompanyPostCreateInput,
  ctx: MutationCtx = {}
) {
  await requireCompanyMember(actor.id, companyId);
  if (!actor.emailVerifiedAt) throw new EmailUnverifiedError();
  const company = await getActiveCompany(companyId);
  const post = await db.post.create<PostWithIncludes>({
    data: {
      authorId: actor.id,
      companyId: company.id,
      body: input.body?.trim() || "",
      visibility: input.visibility,
      // NOTE: the Post model stores media via the `media` (PostMedia) relation;
      // PostMedia has no `name` column, so attachment names are dropped here.
      media:
        input.attachments?.length
          ? {
              create: input.attachments.map((a, i) => ({
                kind: a.kind,
                url: a.url,
                mimeType: a.mimeType ?? null,
                sizeBytes: a.sizeBytes ?? null,
                width: a.width ?? null,
                height: a.height ?? null,
                sortOrder: i,
              })),
            }
          : undefined,
    },
    include: postFeedInclude,
  });
  await writeAuditLog({
    actorId: actor.id,
    action: "company.post_create",
    entityType: "company",
    entityId: company.id,
    metadata: { postId: post.id, visibility: input.visibility },
    ipAddress: ctx.ip,
  });
  return serializePostWithViewerState(post, { liked: false, bookmarked: false });
}

/** Manager+ audit-scoped activity feed for the company. */
export async function getActivity(actor: Actor, companyId: string, opts: PageOpts) {
  await requireCompanyManager(actor.id, companyId);
  await getActiveCompany(companyId);
  const logs = await db.auditLog.findMany<AuditLogWithActor>({
    where: { entityType: "company", entityId: companyId, AND: cursorFragment(opts.cursor) },
    include: { actor: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
  });
  const page = logs.slice(0, opts.limit);
  return {
    data: page.map((l) => ({
      id: l.id,
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId,
      metadata: l.metadata,
      ipAddress: l.ipAddress,
      createdAt: l.createdAt.toISOString(),
      actor: l.actor ? publicUser(l.actor as User) : null,
    })),
    nextCursor:
      logs.length > opts.limit
        ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id)
        : null,
  };
}

// ─── Company analytics ──────────────────────────────────────────────────────

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Analytics for a single company: totals + 30-day series for member growth,
 * posts, and messages. Manager+ only.
 */
export async function getCompanyAnalytics(actor: Actor, companyId: string, days = 30) {
  await requireCompanyManager(actor.id, companyId);
  await getActiveCompany(companyId);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [joins, posts, messages, totals] = await Promise.all([
    db.companyMember.findMany({
      where: { companyId, joinedAt: { gte: since } },
      select: { joinedAt: true },
    }),
    db.post.findMany({
      where: { companyId, createdAt: { gte: since }, deletedAt: null },
      select: { createdAt: true },
    }),
    db.message.findMany({
      where: { conversation: { companyId }, createdAt: { gte: since }, deletedAt: null },
      select: { createdAt: true },
    }),
    db.companyMember.count({ where: { companyId } }),
  ]);

  const now = Date.now();
  const perDay = (rows: { createdAt?: Date; joinedAt?: Date }[], key: "createdAt" | "joinedAt") => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const d = r[key];
      if (!d) continue;
      const k = dayKey(d);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    const out: { date: string; count: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = dayKey(new Date(now - i * 24 * 3600e3));
      out.push({ date: k, count: map.get(k) ?? 0 });
    }
    return out;
  };

  // Cumulative member growth series.
  const joinsPerDay = perDay(joins, "joinedAt");
  const baseMembers = totals - joins.length;
  let running = baseMembers;
  const memberGrowth = joinsPerDay.map((p) => {
    running += p.count;
    return { date: p.date, count: running };
  });

  const [postCount, messageCount, teamCount, pendingInvites] = await Promise.all([
    db.post.count({ where: { companyId, deletedAt: null } }),
    db.message.count({ where: { conversation: { companyId }, deletedAt: null } }),
    db.team.count({ where: { companyId } }),
    db.invitation.count({ where: { companyId, status: "PENDING" } }),
  ]);

  return {
    totals: {
      members: totals,
      posts: postCount,
      messages: messageCount,
      teams: teamCount,
      pendingInvites,
    },
    memberGrowth,
    postsPerDay: perDay(posts, "createdAt"),
    messagesPerDay: perDay(messages, "createdAt"),
  };
}

// ─── Join requests ──────────────────────────────────────────────────────────

function joinRequestView(r: CompanyJoinRequestWithUser) {
  return {
    id: r.id,
    companyId: r.companyId,
    message: r.message,
    status: r.status,
    reviewedById: r.reviewedById,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    user: publicUser(r.user as User),
  };
}

/**
 * Request to join a company. Any verified user who isn't already a member
 * (and has no pending request) can ask to join.
 */
export async function createJoinRequest(
  actor: Actor,
  companyId: string,
  input: JoinRequestCreateInput,
  ctx: MutationCtx = {}
) {
  if (!actor.emailVerifiedAt) throw new EmailUnverifiedError();
  await getActiveCompany(companyId);
  const existing = await getCompanyMembership(actor.id, companyId);
  if (existing) throw new ConflictError("ALREADY_MEMBER", "You are already a member of this company");
  const pending = await db.companyJoinRequest.findUnique({
    where: { companyId_userId: { companyId, userId: actor.id } },
  });
  if (pending && pending.status === "PENDING") {
    throw new ConflictError("REQUEST_PENDING", "You already have a pending request for this company");
  }
  const created = await db.companyJoinRequest.upsert({
    where: { companyId_userId: { companyId, userId: actor.id } },
    update: { message: input.message ?? null, status: "PENDING", reviewedById: null },
    create: { companyId, userId: actor.id, message: input.message ?? null },
    include: { user: true },
  });
  await writeAuditLog({
    actorId: actor.id,
    action: "company.join_request_create",
    entityType: "company",
    entityId: companyId,
    metadata: { requestId: created.id },
    ipAddress: ctx.ip,
  });
  return joinRequestView(created as CompanyJoinRequestWithUser);
}

/** List join requests for a company. Manager+ only. */
export async function listJoinRequests(actor: Actor, companyId: string, status?: JoinRequestStatus) {
  await requireCompanyManager(actor.id, companyId);
  await getActiveCompany(companyId);
  const requests = await db.companyJoinRequest.findMany({
    where: { companyId, ...(status ? { status } : {}) },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
  return requests.map((r) => joinRequestView(r as CompanyJoinRequestWithUser));
}

/**
 * Approve or decline a join request. Approving adds the user as a MEMBER.
 * Manager+ only.
 */
export async function reviewJoinRequest(
  actor: Actor,
  companyId: string,
  requestId: string,
  input: JoinRequestReviewInput,
  ctx: MutationCtx = {}
) {
  await requireCompanyManager(actor.id, companyId);
  await getActiveCompany(companyId);
  const request = await db.companyJoinRequest.findUnique<CompanyJoinRequestWithUser>({
    where: { id: requestId },
    include: { user: true },
  });
  if (!request || request.companyId !== companyId) {
    throw new NotFoundError("Join request not found");
  }
  if (request.status !== "PENDING") {
    throw new ConflictError("ALREADY_REVIEWED", "This request has already been reviewed");
  }
  const status: JoinRequestStatus = input.action === "APPROVE" ? "APPROVED" : "DECLINED";
  // Checked before the transaction so a refusal writes nothing at all — not
  // even the reviewed status. Approving is a membership grant, so it is bound
  // by the cap exactly like every other grant.
  if (status === "APPROVED") {
    const already = await getCompanyMembership(request.userId, companyId);
    if (!already) {
      await assertRoomForAnotherCompany(request.userId, request.user.platformRole, "other");
    }
  }
  const updated = await db.$transaction(async (tx) => {
    const r = await tx.companyJoinRequest.update({
      where: { id: requestId },
      data: { status, reviewedById: actor.id },
      include: { user: true },
    });
    if (status === "APPROVED") {
      const existing = await tx.companyMember.findUnique({
        where: { companyId_userId: { companyId, userId: request.userId } },
      });
      if (!existing) {
        await tx.companyMember.create({ data: { companyId, userId: request.userId, role: "MEMBER" } });
      }
    }
    return r;
  });
  await writeAuditLog({
    actorId: actor.id,
    action: status === "APPROVED" ? "company.join_request_approve" : "company.join_request_decline",
    entityType: "company",
    entityId: companyId,
    metadata: { requestId, targetUserId: request.userId },
    ipAddress: ctx.ip,
  });
  return joinRequestView(updated as CompanyJoinRequestWithUser);
}
