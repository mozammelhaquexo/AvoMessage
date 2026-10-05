/**
 * lib/services/admin.ts — platform administration (Backend Engineer B).
 *
 * EVERY function here requires ADMIN+ (requireSuperAdmin where noted).
 * All mutations are audit-logged. Suspend revokes sessions.
 */
import { prisma } from "@/lib/db";

/** Typed DB facade (pre-generation stand-in; real client later). */
const db = prisma as unknown as PrismaClientLike;
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { COMPANY_ADMIN_ROLES, isCompanyManagerRole } from "@/lib/company-roles";
import { PLATFORM_ADMIN_ROLES, assertSingleAdminRule } from "./platform-admin-policy";
import { hashPassword } from "@/lib/auth/password";
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
import { revokeAllSessions } from "@/lib/auth/session";
import { decodeCursor, encodeCursor } from "@/lib/api";
import type {
  Actor,
  AuditLogWithActor,
  CommentWithAuthor,
  Company,
  CompanyMember,
  CompanyRole,
  MessageWithSender,
  PlatformRole,
  PostWithAuthor,
  PrismaClientLike,
  Report,
  ReportFull,
  Team,
  TeamMember,
  User,
} from "@/lib/prisma-types";
import { postSummary, publicCompany, publicUser, stripAnnouncementTitle } from "./serialize";
import type {
  AdminAnnouncementCreateInput,
  AdminCompanyUpdateInput,
  AdminUserUpdateInput,
  AccountOtpRequestInput,
  ModerationActionInput,
  ReportResolveInput,
  SystemSettingInput,
} from "@/lib/validation";
import type { PageOpts } from "./companies";

interface MutationCtx {
  ip?: string | null;
}

function assertAdmin(actor: Actor): void {
  if (actor.platformRole !== "ADMIN" && actor.platformRole !== "SUPER_ADMIN") {
    throw new ForbiddenError("FORBIDDEN", "Admin access required");
  }
}

function assertSuperAdmin(actor: Actor): void {
  if (actor.platformRole !== "SUPER_ADMIN") {
    throw new ForbiddenError("FORBIDDEN", "Super-admin access required");
  }
}

/**
 * How many accounts hold a platform admin role, optionally excluding one.
 *
 * The RULE this feeds lives in `lib/services/platform-admin-policy.ts`, so every
 * branch of it is testable without arranging database state. This is only the
 * count.
 */
async function countPlatformAdmins(excludeUserId?: string): Promise<number> {
  return db.user.count({
    where: {
      platformRole: { in: [...PLATFORM_ADMIN_ROLES] },
      deletedAt: null,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
  });
}

function cursorFragment(cursor: string | null): Record<string, unknown>[] {
  if (!cursor) return [];
  const { createdAt, id } = decodeCursor(cursor);
  return [{ OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] }];
}

async function pageOf<T extends { createdAt: Date; id: string }>(
  rows: T[],
  limit: number
): Promise<{ data: T[]; nextCursor: string | null }> {
  const page = rows.slice(0, limit);
  return {
    data: page,
    nextCursor:
      rows.length > limit
        ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id)
        : null,
  };
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

export async function dashboard(actor: Actor) {
  assertAdmin(actor);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [users, posts, messages, companies, reportsPending, signups7d] = await Promise.all([
    db.user.count({ where: { deletedAt: null, isActive: true } }),
    db.post.count({ where: { deletedAt: null } }),
    db.message.count({ where: { deletedAt: null } }),
    db.company.count({ where: { isActive: true } }),
    db.report.count({ where: { status: "PENDING" } }),
    db.user.count({ where: { createdAt: { gte: weekAgo } } }),
  ]);
  return { users, posts, messages, companies, reportsPending, signups7d };
}

// ─── Users ──────────────────────────────────────────────────────────────────

export interface UserFilters extends PageOpts {
  search?: string;
  platformRole?: PlatformRole;
  isActive?: boolean;
}

export async function listUsers(actor: Actor, filters: UserFilters) {
  assertAdmin(actor);
  const where: Record<string, unknown> = { deletedAt: null, AND: cursorFragment(filters.cursor) };
  if (filters.platformRole) where.platformRole = filters.platformRole;
  if (filters.isActive !== undefined) where.isActive = filters.isActive;
  if (filters.search) {
    const q = filters.search;
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { username: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }
  const users = await db.user.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: filters.limit + 1,
  });
  const { data, nextCursor } = await pageOf(users, filters.limit);
  return {
    data: data.map((u) => ({
      ...publicUser(u),
      email: u.email,
      platformRole: u.platformRole,
      isActive: u.isActive,
      emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
    })),
    nextCursor,
  };
}

export async function getUserDetail(actor: Actor, id: string) {
  assertAdmin(actor);
  const user = await db.user.findUnique({ where: { id } });
  if (!user || user.deletedAt) throw new NotFoundError("User not found");
  const [postCount, followerCount, followingCount, loginActivity] = await Promise.all([
    db.post.count({ where: { authorId: id, deletedAt: null } }),
    db.follow.count({ where: { followingId: id } }),
    db.follow.count({ where: { followerId: id } }),
    db.loginActivity.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);
  return {
    user: {
      ...publicUser(user),
      email: user.email,
      platformRole: user.platformRole,
      isActive: user.isActive,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    },
    counts: { posts: postCount, followers: followerCount, following: followingCount },
    loginActivity: loginActivity.map((l) => ({
      id: l.id,
      success: l.success,
      reason: l.reason,
      ipAddress: l.ipAddress,
      userAgent: l.userAgent,
      createdAt: l.createdAt.toISOString(),
    })),
  };
}

export async function updateUser(
  actor: Actor,
  targetId: string,
  input: AdminUserUpdateInput,
  ctx: MutationCtx = {}
) {
  assertAdmin(actor);
  const target = await db.user.findUnique({ where: { id: targetId } });
  if (!target || target.deletedAt) throw new NotFoundError("User not found");

  // RBAC: admins cannot touch other admins; only super-admins grant ADMIN.
  const targetIsPrivileged =
    target.platformRole === "ADMIN" || target.platformRole === "SUPER_ADMIN";
  if (targetIsPrivileged && actor.platformRole !== "SUPER_ADMIN" && actor.id !== targetId) {
    throw new ForbiddenError("FORBIDDEN", "Only super-admins can manage admin accounts");
  }
  if (input.platformRole && input.platformRole !== "USER") {
    assertSuperAdmin(actor);
  }
  if (targetId === actor.id && input.isActive === false) {
    throw new ConflictError("SELF_SUSPEND", "You cannot suspend your own account");
  }

  // Exactly one administrator (part 2, request 4): nobody can be promoted into
  // the role, and the one admin cannot step down out of it. The rule itself is
  // pure and lives in platform-admin-policy.ts; only the count comes from here.
  if (input.platformRole !== undefined && input.platformRole !== target.platformRole) {
    assertSingleAdminRule(
      target.platformRole,
      input.platformRole,
      await countPlatformAdmins(targetId),
    );
  }

  const data: Record<string, unknown> = {};
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.platformRole !== undefined) data.platformRole = input.platformRole;
  if (input.isVerified !== undefined) data.isVerified = input.isVerified;
  // Email verification gates sign-in, so it is the field that actually unblocks
  // a locked-out user. `null` clears it; an ISO string marks it verified.
  if (input.emailVerifiedAt !== undefined) {
    data.emailVerifiedAt = input.emailVerifiedAt === null ? null : new Date(input.emailVerifiedAt);
  }

  const updated = await db.user.update({ where: { id: targetId }, data });

  let sessionsRevoked = 0;
  if (input.isActive === false && target.isActive) {
    sessionsRevoked = await revokeAllSessions(targetId);
  }

  await writeAuditLog({
    actorId: actor.id,
    action: input.isActive === false ? "admin.user_suspend" : "admin.user_update",
    entityType: "user",
    entityId: targetId,
    metadata: { changes: Object.keys(input), sessionsRevoked },
    ipAddress: ctx.ip,
  });

  return {
    user: {
      ...publicUser(updated),
      email: updated.email,
      platformRole: updated.platformRole,
      isActive: updated.isActive,
    },
    sessionsRevoked,
  };
}

// ─── Managers & companies ───────────────────────────────────────────────────

/**
 * The merged "Managers" section (request 5).
 *
 * The admin nav used to have two entries — Managers (a flat list of people) and
 * Companies (a list of workspaces). They are now ONE section, because a manager
 * only ever exists inside a company: the useful view is "which companies have
 * how many managers". Clicking through goes to `getManagerCompanyDetail`.
 */
export async function listManagerCompanies(
  actor: Actor,
  opts: PageOpts & { search?: string; isActive?: boolean }
) {
  assertAdmin(actor);
  const where: Record<string, unknown> = { AND: cursorFragment(opts.cursor) };
  if (opts.isActive !== undefined) where.isActive = opts.isActive;
  if (opts.search) {
    where.OR = [
      { name: { contains: opts.search, mode: "insensitive" } },
      { slug: { contains: opts.search, mode: "insensitive" } },
    ];
  }
  const companies = await db.company.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
  });
  const { data, nextCursor } = await pageOf(companies, opts.limit);

  // Counts batched per company (bounded by page size, two counts each).
  const withCounts = await Promise.all(
    data.map(async (c) => {
      const [memberCount, managerCount] = await Promise.all([
        db.companyMember.count({ where: { companyId: c.id } }),
        db.companyMember.count({
          where: { companyId: c.id, role: { in: ["OWNER", "MANAGER"] } },
        }),
      ]);
      return { ...publicCompany(c), memberCount, managerCount };
    })
  );
  return { data: withCounts, nextCursor };
}

/** Cap on the member roster returned by `getManagerCompanyDetail`. */
const MANAGER_DETAIL_MEMBER_CAP = 200;

/**
 * Full-page detail for one company's managers (request 5).
 *
 * "Users under a manager" is defined as the distinct people on the teams that
 * manager leads — teams are the app's only real grouping of people, and
 * `TeamMember.role = MANAGER` is the only per-manager assignment that exists.
 * A manager who leads no team therefore reports zero, which the UI states
 * plainly rather than inventing a number.
 */
export async function getManagerCompanyDetail(actor: Actor, companyId: string) {
  assertAdmin(actor);
  const company = await db.company.findUnique<Company>({ where: { id: companyId } });
  if (!company) throw new NotFoundError("Company not found");

  const [members, teams] = await Promise.all([
    db.companyMember.findMany<CompanyMember & { user: User }>({
      where: { companyId },
      include: { user: true },
      orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
    }),
    db.team.findMany<Team>({ where: { companyId }, orderBy: { createdAt: "asc" } }),
  ]);

  const teamIds = teams.map((t) => t.id);
  const teamRows = teamIds.length
    ? await db.teamMember.findMany<TeamMember>({
        where: { teamId: { in: teamIds } },
        select: { teamId: true, userId: true, role: true },
      })
    : [];

  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const roster = new Map<string, Set<string>>(); // teamId → member userIds
  const ledTeams = new Map<string, string[]>(); // userId → teamIds they manage
  for (const r of teamRows) {
    const set = roster.get(r.teamId) ?? new Set<string>();
    set.add(r.userId);
    roster.set(r.teamId, set);
    if (r.role === "MANAGER") {
      const arr = ledTeams.get(r.userId) ?? [];
      arr.push(r.teamId);
      ledTeams.set(r.userId, arr);
    }
  }

  const managers = members
    .filter((m) => m.role === "OWNER" || m.role === "MANAGER")
    .map((m) => {
      const ids = ledTeams.get(m.userId) ?? [];
      const under = new Set<string>();
      for (const teamId of ids) {
        for (const userId of roster.get(teamId) ?? []) {
          if (userId !== m.userId) under.add(userId);
        }
      }
      return {
        user: publicUser(m.user),
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
        teamsLed: ids.map((id) => ({
          id,
          name: teamName.get(id) ?? "Team",
          memberCount: roster.get(id)?.size ?? 0,
        })),
        usersUnder: under.size,
      };
    })
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));

  const plainMembers = members.filter((m) => m.role === "MEMBER");
  const usersInTeams = new Set<string>();
  for (const set of roster.values()) for (const u of set) usersInTeams.add(u);

  return {
    company: publicCompany(company),
    counts: {
      managers: managers.length,
      members: plainMembers.length,
      teams: teams.length,
      usersInTeams: usersInTeams.size,
    },
    managers,
    members: plainMembers.slice(0, MANAGER_DETAIL_MEMBER_CAP).map((m) => ({
      user: publicUser(m.user),
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    })),
    membersTruncated: plainMembers.length > MANAGER_DETAIL_MEMBER_CAP,
  };
}

/**
 * Platform-wide flat list of company owners/managers. Kept for API consumers
 * that want people rather than companies; the admin UI now uses
 * `listManagerCompanies`.
 */
export async function listManagers(
  actor: Actor,
  opts: PageOpts & { companyId?: string }
) {
  assertAdmin(actor);
  const where: Record<string, unknown> = {
    role: { in: ["OWNER", "MANAGER"] },
    ...(opts.companyId ? { companyId: opts.companyId } : {}),
  };
  const rows = await db.companyMember.findMany<
    CompanyMember & { user: User; company: Company }
  >({
    where,
    include: { user: true, company: true },
    orderBy: { joinedAt: "desc" },
    take: opts.limit + 1,
  });
  const { data, nextCursor } = await pageOf(
    rows.map((r) => ({ ...r, createdAt: r.joinedAt, id: `${r.companyId}:${r.userId}` })),
    opts.limit
  );
  return {
    data: data.map((r) => ({
      user: publicUser(r.user),
      company: publicCompany(r.company),
      role: r.role,
      joinedAt: r.joinedAt.toISOString(),
    })),
    nextCursor,
  };
}

export async function listCompaniesAdmin(
  actor: Actor,
  opts: PageOpts & { search?: string; isActive?: boolean }
) {
  assertAdmin(actor);
  const where: Record<string, unknown> = { AND: cursorFragment(opts.cursor) };
  if (opts.isActive !== undefined) where.isActive = opts.isActive;
  if (opts.search) {
    where.OR = [
      { name: { contains: opts.search, mode: "insensitive" } },
      { slug: { contains: opts.search, mode: "insensitive" } },
    ];
  }
  const companies = await db.company.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
  });
  const { data, nextCursor } = await pageOf(companies, opts.limit);
  // Member counts batched per company (bounded by page size).
  const withCounts = await Promise.all(
    data.map(async (c) => ({
      ...publicCompany(c),
      memberCount: await db.companyMember.count({ where: { companyId: c.id } }),
    }))
  );
  return { data: withCounts, nextCursor };
}

export async function updateCompanyAdmin(
  actor: Actor,
  id: string,
  input: AdminCompanyUpdateInput,
  ctx: MutationCtx = {}
) {
  assertAdmin(actor);
  const company = await db.company.findUnique({ where: { id } });
  if (!company) throw new NotFoundError("Company not found");
  const updated = await db.company.update({ where: { id }, data: { isActive: input.isActive } });
  await writeAuditLog({
    actorId: actor.id,
    action: input.isActive === false ? "admin.company_deactivate" : "admin.company_reactivate",
    entityType: "company",
    entityId: id,
    metadata: {},
    ipAddress: ctx.ip,
  });
  return { company: publicCompany(updated) };
}

/**
 * Admin-only: remove a company, permanently, along with everything scoped to it.
 *
 * ── Why this is not just `db.company.delete` ────────────────────────────────
 *
 * The schema cascades from Company to CompanyMember, Team, Post,
 * CompanyJoinRequest and Invitation, and sets `companyId` to null on
 * Conversation and ManagerApplication. So a single delete also destroys the
 * company's memberships, its teams and — the part that actually matters — every
 * post filed under it. None of that comes back, so the deletion is gated twice:
 *
 *   1. **The company must already be deactivated.** `isActive: false` is the
 *      reversible step, and an admin who has not taken it has not yet decided
 *      the company should stop existing. It also means a live company cannot be
 *      destroyed by one misclick, which is the whole risk with a hard delete.
 *
 *   2. **The counts are read BEFORE the delete.** Afterwards there is nothing
 *      left to count, and an audit entry reading "company deleted" without
 *      saying how much went with it is not an audit entry. The numbers go into
 *      the log, where they survive the rows.
 *
 * Returns the identity of what was removed rather than the removed row — the
 * row no longer exists, and the admin list needs the id to drop it from the
 * table.
 */
export async function deleteCompanyAdmin(actor: Actor, id: string, ctx: MutationCtx = {}) {
  assertAdmin(actor);

  const company = await db.company.findUnique({ where: { id } });
  if (!company) throw new NotFoundError("Company not found");

  if (company.isActive) {
    throw new ConflictError(
      "COMPANY_ACTIVE",
      "Deactivate the company first. Deactivation is reversible; deleting it is not."
    );
  }

  // Count first — the cascade is about to remove the evidence.
  const [memberCount, postCount, teamCount] = await Promise.all([
    db.companyMember.count({ where: { companyId: id } }),
    db.post.count({ where: { companyId: id } }),
    db.team.count({ where: { companyId: id } }),
  ]);

  await db.company.delete({ where: { id } });

  await writeAuditLog({
    actorId: actor.id,
    action: "admin.company_delete",
    entityType: "company",
    entityId: id,
    metadata: {
      name: company.name,
      slug: company.slug,
      memberCount,
      postCount,
      teamCount,
    },
    ipAddress: ctx.ip,
  });

  return {
    deleted: true as const,
    company: { id: company.id, name: company.name, slug: company.slug },
    removed: { memberCount, postCount, teamCount },
  };
}

// ─── Company managers ───────────────────────────────────────────────────────

/**
 * Admin-only: grant or revoke the Manager role inside one company.
 *
 * Part 2, request 3 — "a manager cannot create another manager; a new manager
 * is added only from the Admin panel". This function is the whole of that
 * "only": every company-facing path (add member, change role, create account,
 * invitation) accepts MEMBER alone, so this is the single door through which a
 * company gains an administrator.
 *
 * `role` is typed MANAGER | MEMBER, which means OWNER cannot be expressed here
 * at all — the compile-time half of request 7. The runtime schema
 * (`adminCompanyMemberRoleSchema`) applies the same restriction to HTTP input.
 *
 * Demotion keeps the last-manager invariant: a company must always retain at
 * least one administrator, or nobody but a platform admin could ever manage it
 * again.
 */
export async function setCompanyMemberRole(
  actor: Actor,
  companyId: string,
  userId: string,
  role: Extract<CompanyRole, "MANAGER" | "MEMBER">,
  ctx: MutationCtx = {}
) {
  assertAdmin(actor);
  const company = await db.company.findUnique<Company>({ where: { id: companyId } });
  if (!company) throw new NotFoundError("Company not found");

  const target = await db.companyMember.findUnique<CompanyMember & { user: User }>({
    where: { companyId_userId: { companyId, userId } },
    include: { user: true },
  });
  if (!target) throw new NotFoundError("Membership not found");

  const view = (m: CompanyMember & { user: User }) => ({
    user: publicUser(m.user),
    role: m.role,
    joinedAt: m.joinedAt.toISOString(),
  });

  // Idempotent: setting the role someone already has is a no-op, not an error.
  if (target.role === role) return { member: view(target) };

  // Invariant: a company always keeps at least one administrator. A legacy
  // OWNER row counts, which is why the test is manager-OR-owner on both sides.
  if (isCompanyManagerRole(target.role) && !isCompanyManagerRole(role)) {
    const admins = await db.companyMember.count({
      where: { companyId, role: { in: COMPANY_ADMIN_ROLES } },
    });
    if (admins <= 1) {
      throw new ConflictError("LAST_MANAGER", "A company must keep at least one manager");
    }
  }

  const updated = await db.companyMember.update<CompanyMember & { user: User }>({
    where: { companyId_userId: { companyId, userId } },
    data: { role },
    include: { user: true },
  });

  // Tell the person. Best-effort: a failed notification must not undo the grant.
  await db.notification
    .create({
      data: {
        userId,
        actorId: actor.id,
        type: "COMPANY_ROLE_CHANGED",
        entityType: "company",
        entityId: companyId,
        title: role === "MANAGER" ? "You are now a manager" : "Your manager role was removed",
        body:
          role === "MANAGER"
            ? `An administrator made you a manager of ${company.name}`
            : `An administrator removed your manager role at ${company.name}`,
      },
    })
    .catch(() => null);

  await writeAuditLog({
    actorId: actor.id,
    action: "admin.company_member_role_change",
    entityType: "company",
    entityId: companyId,
    metadata: { targetUserId: userId, from: target.role, to: role },
    ipAddress: ctx.ip,
  });

  return { member: view(updated) };
}

// ─── Admin-created manager accounts ─────────────────────────────────────────
//
// The ONE door to the MANAGER role (lib/services/company-role-policy.ts). A
// company manager cannot use it; only an administrator can, and this is the
// path the admin console's "Add manager" form drives.
//
// It creates a brand-new USER as well as the membership — the admin supplies
// the address and a password, and the account exists only after that address
// confirms a code. Promoting an EXISTING user is `setCompanyMemberRole` above.

export async function requestManagerAccountOtp(
  actor: Actor,
  companyId: string,
  input: AccountOtpRequestInput,
  ctx: MutationCtx = {}
): Promise<OtpRequestResult> {
  assertAdmin(actor);
  const company = await db.company.findUnique<Company>({ where: { id: companyId } });
  if (!company) throw new NotFoundError("Company not found");

  const email = input.email.toLowerCase().trim();
  const emailTaken = await db.user.findUnique({ where: { email } });
  if (emailTaken) throw new ConflictError("EMAIL_TAKEN", "Email is already registered");
  const usernameTaken = await db.user.findUnique({ where: { username: input.username } });
  if (usernameTaken) throw new ConflictError("USERNAME_TAKEN", "Username is already taken");

  const passwordHash = await hashPassword(input.password);

  const issued = await issueOtpChallenge({
    purpose: OtpPurpose.COMPANY_MANAGER,
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
    purpose: "COMPANY_MANAGER",
    companyName: company.name,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "admin.manager_otp_sent",
    entityType: "company",
    entityId: companyId,
    metadata: { email, role: "MANAGER" },
    ipAddress: ctx.ip,
  });

  return otpRequestWire(issued, email);
}

export async function completeManagerAccountOtp(
  actor: Actor,
  challengeId: string,
  code: string,
  ctx: MutationCtx = {}
) {
  // Re-decided here rather than inherited from the request: the code was in
  // flight for up to ten minutes, and admin rights can be withdrawn in that
  // window. This call reads the database now.
  assertAdmin(actor);

  const challenge = await verifyOtpCode(challengeId, code);
  assertPurpose(challenge, OtpPurpose.COMPANY_MANAGER);

  const payload = challenge.payload as {
    companyId: string;
    name: string;
    username: string;
    email: string;
    passwordHash: string;
  };

  const company = await db.company.findUnique<Company>({ where: { id: payload.companyId } });
  if (!company) throw new NotFoundError("Company not found");

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: payload.email,
        passwordHash: payload.passwordHash,
        name: payload.name,
        username: payload.username,
        emailVerifiedAt: new Date(),
      },
    });
    // No capacity check: `created` is new in this transaction, so this is its
    // first membership by construction. The cap still binds every LATER add —
    // see assertRoomForAnotherCompany in lib/services/companies.ts.
    await tx.companyMember.create({
      data: { companyId: payload.companyId, userId: created.id, role: "MANAGER" },
    });
    return created;
  });

  await consumeOtpChallenge(challenge.id);

  await db.notification
    .create({
      data: {
        userId: user.id,
        actorId: actor.id,
        type: "COMPANY_ROLE_CHANGED",
        entityType: "company",
        entityId: payload.companyId,
        title: "You are now a manager",
        body: `An administrator made you a manager of ${company.name}`,
      },
    })
    .catch(() => null);

  await writeAuditLog({
    actorId: actor.id,
    action: "admin.manager_account_create",
    entityType: "company",
    entityId: payload.companyId,
    metadata: { targetUserId: user.id, email: user.email, role: "MANAGER", via: "otp" },
    ipAddress: ctx.ip,
  });

  return { user: publicUser(user), companyId: payload.companyId, role: "MANAGER" as const };
}

// ─── Content moderation ─────────────────────────────────────────────────────

export async function listPostsAdmin(
  actor: Actor,
  opts: PageOpts & { authorId?: string; includeDeleted?: boolean }
) {
  assertAdmin(actor);
  const where: Record<string, unknown> = { AND: cursorFragment(opts.cursor) };
  if (!opts.includeDeleted) where.deletedAt = null;
  if (opts.authorId) where.authorId = opts.authorId;
  const posts = await db.post.findMany<PostWithAuthor>({
    where,
    include: { author: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
  });
  const { data, nextCursor } = await pageOf(posts, opts.limit);
  return {
    data: data.map((p) => ({ ...postSummary(p), deleted: p.deletedAt !== null })),
    nextCursor,
  };
}

export async function deletePostAdmin(actor: Actor, id: string, ctx: MutationCtx = {}) {
  assertAdmin(actor);
  const post = await db.post.findUnique({ where: { id } });
  if (!post || post.deletedAt) throw new NotFoundError("Post not found");
  await db.post.update({ where: { id }, data: { deletedAt: new Date() } });
  await writeAuditLog({
    actorId: actor.id,
    action: "admin.content_delete",
    entityType: "post",
    entityId: id,
    metadata: { authorId: post.authorId },
    ipAddress: ctx.ip,
  });
  return { ok: true as const };
}

export async function listCommentsAdmin(actor: Actor, opts: PageOpts & { includeDeleted?: boolean }) {
  assertAdmin(actor);
  const where: Record<string, unknown> = { AND: cursorFragment(opts.cursor) };
  if (!opts.includeDeleted) where.deletedAt = null;
  const comments = await db.comment.findMany<CommentWithAuthor>({
    where,
    include: { author: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
  });
  const { data, nextCursor } = await pageOf(comments, opts.limit);
  return {
    data: data.map((c) => ({
      id: c.id,
      postId: c.postId,
      body: c.body,
      author: publicUser(c.author),
      deleted: c.deletedAt !== null,
      createdAt: c.createdAt.toISOString(),
    })),
    nextCursor,
  };
}

export async function deleteCommentAdmin(actor: Actor, id: string, ctx: MutationCtx = {}) {
  assertAdmin(actor);
  const comment = await db.comment.findUnique({ where: { id } });
  if (!comment || comment.deletedAt) throw new NotFoundError("Comment not found");
  await db.comment.update({ where: { id }, data: { deletedAt: new Date() } });
  await db.post.update({
    where: { id: comment.postId },
    data: { commentCount: { decrement: 1 } },
  }).catch(() => null);
  await writeAuditLog({
    actorId: actor.id,
    action: "admin.content_delete",
    entityType: "comment",
    entityId: id,
    metadata: { authorId: comment.authorId, postId: comment.postId },
    ipAddress: ctx.ip,
  });
  return { ok: true as const };
}

async function reportTargetSnapshot(targetType: string, targetId: string) {
  try {
    if (targetType === "POST") {
      const p = await db.post.findUnique<PostWithAuthor>({ where: { id: targetId }, include: { author: true } });
      return p ? { body: p.body.slice(0, 200), author: publicUser(p.author), deleted: !!p.deletedAt } : null;
    }
    if (targetType === "COMMENT") {
      const c = await db.comment.findUnique<CommentWithAuthor>({ where: { id: targetId }, include: { author: true } });
      return c ? { body: c.body.slice(0, 200), author: publicUser(c.author), deleted: !!c.deletedAt } : null;
    }
    if (targetType === "MESSAGE") {
      const m = await db.message.findUnique<MessageWithSender>({ where: { id: targetId }, include: { sender: true } });
      return m ? { body: (m.body ?? "").slice(0, 200), author: m.sender ? publicUser(m.sender) : null, deleted: !!m.deletedAt } : null;
    }
    const u = await db.user.findUnique({ where: { id: targetId } });
    return u ? { user: publicUser(u) } : null;
  } catch {
    return null;
  }
}

export async function listReports(
  actor: Actor,
  opts: PageOpts & { status?: "PENDING" | "IN_REVIEW" | "ACTIONED" | "DISMISSED" }
) {
  assertAdmin(actor);
  const where: Record<string, unknown> = { AND: cursorFragment(opts.cursor) };
  if (opts.status) where.status = opts.status;
  const reports = await db.report.findMany<Report & { reporter: User }>({
    where,
    include: { reporter: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
  });
  const { data, nextCursor } = await pageOf(reports, opts.limit);
  const withSnapshots = await Promise.all(
    data.map(async (r) => ({
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      reason: r.reason,
      details: r.details,
      status: r.status,
      reporter: publicUser(r.reporter),
      createdAt: r.createdAt.toISOString(),
      snapshot: await reportTargetSnapshot(r.targetType, r.targetId),
    }))
  );
  return { data: withSnapshots, nextCursor };
}

export async function getReport(actor: Actor, id: string) {
  assertAdmin(actor);
  const r = await db.report.findUnique<ReportFull>({ where: { id }, include: { reporter: true, reviewer: true } });
  if (!r) throw new NotFoundError("Report not found");
  return {
    id: r.id,
    targetType: r.targetType,
    targetId: r.targetId,
    reason: r.reason,
    details: r.details,
    status: r.status,
    reporter: publicUser(r.reporter),
    reviewer: r.reviewer ? publicUser(r.reviewer) : null,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    snapshot: await reportTargetSnapshot(r.targetType, r.targetId),
  };
}

export async function resolveReport(
  actor: Actor,
  id: string,
  input: ReportResolveInput,
  ctx: MutationCtx = {}
) {
  assertAdmin(actor);
  const report = await db.report.findUnique({ where: { id } });
  if (!report) throw new NotFoundError("Report not found");

  if (input.action === "delete_content") {
    if (report.targetType === "POST") {
      await db.post.update({ where: { id: report.targetId }, data: { deletedAt: new Date() } }).catch(() => null);
    } else if (report.targetType === "COMMENT") {
      await db.comment.update({ where: { id: report.targetId }, data: { deletedAt: new Date() } }).catch(() => null);
    } else if (report.targetType === "MESSAGE") {
      await db.message.update({ where: { id: report.targetId }, data: { deletedAt: new Date() } }).catch(() => null);
    }
  } else if (input.action === "suspend_user") {
    if (report.targetType !== "USER") {
      throw new ConflictError("INVALID_ACTION", "suspend_user requires a USER report target");
    }
    const target = await db.user.findUnique({ where: { id: report.targetId } });
    if (target && (target.platformRole === "ADMIN" || target.platformRole === "SUPER_ADMIN")) {
      assertSuperAdmin(actor);
    }
    await db.user.update({ where: { id: report.targetId }, data: { isActive: false } }).catch(() => null);
    await revokeAllSessions(report.targetId);
  }

  const updated = await db.report.update<Report & { reporter: User }>({
    where: { id },
    data: { status: input.status, reviewerId: actor.id, reviewedAt: new Date() },
    include: { reporter: true },
  });

  // Notify the reporter of the outcome.
  await db.notification
    .create({
      data: {
        userId: updated.reporterId,
        type: "REPORT_STATUS",
        entityType: "report",
        entityId: id,
        title: "Report reviewed",
        body: `Your report was reviewed: ${input.status.toLowerCase().replace("_", " ")}`,
      },
    })
    .catch(() => null);

  await writeAuditLog({
    actorId: actor.id,
    action: "admin.report_resolve",
    entityType: "report",
    entityId: id,
    metadata: { status: input.status, action: input.action ?? null },
    ipAddress: ctx.ip,
  });

  return getReport(actor, id);
}

/** Generic moderation action outside the report queue. */
export async function moderationAction(actor: Actor, input: ModerationActionInput, ctx: MutationCtx = {}) {
  assertAdmin(actor);
  const { action, targetType, targetId } = input;
  if (action === "delete_post" && targetType === "POST") {
    await deletePostAdmin(actor, targetId, ctx);
  } else if (action === "delete_comment" && targetType === "COMMENT") {
    await deleteCommentAdmin(actor, targetId, ctx);
  } else if (action === "delete_message" && targetType === "MESSAGE") {
    const msg = await db.message.findUnique({ where: { id: targetId } });
    if (!msg || msg.deletedAt) throw new NotFoundError("Message not found");
    await db.message.update({ where: { id: targetId }, data: { deletedAt: new Date() } });
    await writeAuditLog({
      actorId: actor.id, action: "admin.content_delete", entityType: "message",
      entityId: targetId, metadata: { reason: input.reason ?? null }, ipAddress: ctx.ip,
    });
  } else if (action === "suspend_user" && targetType === "USER") {
    await updateUser(actor, targetId, { isActive: false }, ctx);
  } else {
    throw new ConflictError("INVALID_ACTION", "Action does not match the target type");
  }
  await writeAuditLog({
    actorId: actor.id, action: "admin.moderation", entityType: targetType.toLowerCase(),
    entityId: targetId, metadata: { action, reason: input.reason ?? null }, ipAddress: ctx.ip,
  });
  return { ok: true as const };
}

// ─── Roles overview ─────────────────────────────────────────────────────────

export async function rolesOverview(actor: Actor) {
  assertAdmin(actor);
  const [platformRoles, companyRoleRows] = await Promise.all([
    db.user.groupBy({ by: ["platformRole"], _count: { platformRole: true } }),
    db.companyMember.groupBy({ by: ["role"], _count: { role: true } }),
  ]);
  // A legacy OWNER row counts as a Manager, because that is what it is labelled
  // everywhere else (lib/company-roles.ts). Without this merge the chart would
  // show a role the product no longer has.
  const companyRoleCounts = new Map<CompanyRole, number>();
  for (const r of companyRoleRows) {
    const key: CompanyRole = r.role === "OWNER" ? "MANAGER" : r.role;
    companyRoleCounts.set(key, (companyRoleCounts.get(key) ?? 0) + r._count.role);
  }
  return {
    platformRoles: platformRoles.map((r) => ({ role: r.platformRole, count: r._count.platformRole })),
    companyRoles: [...companyRoleCounts.entries()].map(([role, count]) => ({ role, count })),
    /*
     * Static permission matrix (docs/RBAC.md §2) for the admin UI.
     *
     * Two rows changed as rules changed, because a matrix that advertises a
     * capability the server refuses is worse than no matrix at all:
     *
     *   - `platform.grant_admin` is gone. The platform has exactly one
     *     administrator and the role cannot be handed out by any path
     *     (part 2, request 4).
     *   - `company.change_role` split into grant and revoke. A company manager
     *     can still take the Manager role away, but can no longer give it —
     *     that is an admin-console action (part 2, request 3).
     *
     * Company rows list MANAGER only: the owner role is retired from the
     * product, so there is no owner-only capability left to publish.
     */
    matrix: {
      "platform.user_management": ["SUPER_ADMIN", "ADMIN"],
      "platform.settings": ["SUPER_ADMIN", "ADMIN"],
      "platform.reports": ["SUPER_ADMIN", "ADMIN"],
      "platform.delete_any_content": ["SUPER_ADMIN", "ADMIN"],
      "platform.audit_logs": ["SUPER_ADMIN", "ADMIN"],
      "platform.deactivate_company": ["SUPER_ADMIN", "ADMIN"],
      "company.edit_profile": ["MANAGER"],
      "company.grant_manager_role": ["SUPER_ADMIN", "ADMIN"],
      "company.revoke_manager_role": ["MANAGER"],
      "company.remove_member": ["MANAGER"],
      "company.invite": ["MANAGER"],
      "company.manage_teams": ["MANAGER"],
      "company.deactivate": ["MANAGER"],
    },
  };
}

// ─── Audit logs ─────────────────────────────────────────────────────────────

export interface AuditFilters extends PageOpts {
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
}

export async function queryAuditLogs(actor: Actor, filters: AuditFilters) {
  assertAdmin(actor);
  const where: Record<string, unknown> = { AND: cursorFragment(filters.cursor) };
  if (filters.actorId) where.actorId = filters.actorId;
  if (filters.action) where.action = filters.action;
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.entityId) where.entityId = filters.entityId;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: new Date(filters.from) } : {}),
      ...(filters.to ? { lte: new Date(filters.to) } : {}),
    };
  }
  const logs = await db.auditLog.findMany<AuditLogWithActor>({
    where,
    include: { actor: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: filters.limit + 1,
  });
  const { data, nextCursor } = await pageOf(logs, filters.limit);
  return {
    data: data.map((l) => ({
      id: l.id,
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId,
      metadata: l.metadata,
      ipAddress: l.ipAddress,
      createdAt: l.createdAt.toISOString(),
      actor: l.actor ? publicUser(l.actor) : null,
    })),
    nextCursor,
  };
}

// ─── Analytics ──────────────────────────────────────────────────────────────

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function analytics(actor: Actor, days = 30) {
  assertAdmin(actor);
  const now = Date.now();
  const since = new Date(now - days * 24 * 3600e3);
  const dayAgo = new Date(now - 24 * 3600e3);
  const weekAgo = new Date(now - 7 * 24 * 3600e3);

  // Aggregate in Postgres.
  //
  // This used to `findMany` every login, post, message and signup in the window
  // and bucket them in Node. Nothing bounded it: on a busy instance a single
  // dashboard load streamed the entire 30-day activity history into the
  // function's memory, which is exactly the shape that OOMs a serverless
  // instance. GROUP BY + count(DISTINCT …) moves the work to the database and
  // returns at most `days` rows.
  //
  // `AT TIME ZONE 'UTC'` is load-bearing: `dateKey` below buckets by the UTC
  // calendar day (the previous implementation used `toISOString().slice(0,10)`),
  // and `date_trunc` would otherwise truncate in the server's local timezone.
  const [active, postsPerDay, messagesPerDay, signupsPerDay] = await Promise.all([
    db.$queryRaw<{ dau: number; wau: number; mau: number }[]>`
      SELECT
        count(DISTINCT "userId") FILTER (WHERE "createdAt" >= ${dayAgo})::int  AS "dau",
        count(DISTINCT "userId") FILTER (WHERE "createdAt" >= ${weekAgo})::int AS "wau",
        count(DISTINCT "userId")::int                                          AS "mau"
      FROM "LoginActivity"
      WHERE "success" = true AND "createdAt" >= ${since}`,
    db.$queryRaw<{ date: string; count: number }[]>`
      SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS "date",
             count(*)::int AS "count"
      FROM "Post"
      WHERE "createdAt" >= ${since} AND "deletedAt" IS NULL
      GROUP BY 1`,
    db.$queryRaw<{ date: string; count: number }[]>`
      SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS "date",
             count(*)::int AS "count"
      FROM "Message"
      WHERE "createdAt" >= ${since} AND "deletedAt" IS NULL
      GROUP BY 1`,
    db.$queryRaw<{ date: string; count: number }[]>`
      SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS "date",
             count(*)::int AS "count"
      FROM "User"
      WHERE "createdAt" >= ${since}
      GROUP BY 1`,
  ]);

  /** Zero-fill the series so the charts have one point per day, in order. */
  const perDay = (rows: { date: string; count: number }[]) => {
    const map = new Map(rows.map((r) => [r.date, Number(r.count)]));
    const out: { date: string; count: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const key = dayKey(new Date(now - i * 24 * 3600e3));
      out.push({ date: key, count: map.get(key) ?? 0 });
    }
    return out;
  };

  const a = active[0] ?? { dau: 0, wau: 0, mau: 0 };
  return {
    dau: Number(a.dau),
    wau: Number(a.wau),
    mau: Number(a.mau),
    postsPerDay: perDay(postsPerDay),
    messagesPerDay: perDay(messagesPerDay),
    signupsPerDay: perDay(signupsPerDay),
  };
}

// ─── System settings ────────────────────────────────────────────────────────

export async function getSettings(actor: Actor, key?: string) {
  assertAdmin(actor);
  if (key) {
    const s = await db.systemSetting.findUnique({ where: { key } });
    return s ? { key: s.key, value: s.value } : null;
  }
  const all = await db.systemSetting.findMany({ orderBy: { key: "asc" } });
  return all.map((s) => ({ key: s.key, value: s.value }));
}

export async function updateSetting(actor: Actor, input: SystemSettingInput, ctx: MutationCtx = {}) {
  assertAdmin(actor);
  const setting = await db.systemSetting.upsert({
    where: { key: input.key },
    create: { key: input.key, value: input.value as object, updatedById: actor.id },
    update: { value: input.value as object, updatedById: actor.id },
  });
  await writeAuditLog({
    actorId: actor.id,
    action: "admin.setting_update",
    entityType: "setting",
    entityId: input.key,
    metadata: { key: input.key },
    ipAddress: ctx.ip,
  });
  return { key: setting.key, value: setting.value };
}

// ─── Platform announcements ─────────────────────────────────────────────────

const PLATFORM_ANNOUNCEMENTS_KEY = "announcements.platform";
const MAX_ANNOUNCEMENTS = 20;

interface PlatformAnnouncementEntry {
  postId: string;
  title: string | null;
  createdAt: string;
  createdById: string;
}

async function readAnnouncementEntries(): Promise<PlatformAnnouncementEntry[]> {
  const s = await db.systemSetting.findUnique({ where: { key: PLATFORM_ANNOUNCEMENTS_KEY } });
  const v = s?.value;
  return Array.isArray(v) ? (v as PlatformAnnouncementEntry[]) : [];
}

async function writeAnnouncementEntries(entries: PlatformAnnouncementEntry[], actorId: string) {
  await db.systemSetting.upsert({
    where: { key: PLATFORM_ANNOUNCEMENTS_KEY },
    create: { key: PLATFORM_ANNOUNCEMENTS_KEY, value: entries as unknown as object, updatedById: actorId },
    update: { value: entries as unknown as object, updatedById: actorId },
  });
}

export async function listPlatformAnnouncements(actor: Actor) {
  assertAdmin(actor);
  const entries = await readAnnouncementEntries();
  if (entries.length === 0) return [];
  const posts = await db.post.findMany<PostWithAuthor>({
    where: { id: { in: entries.map((e) => e.postId) }, deletedAt: null },
    include: { author: true },
  });
  const byId = new Map(posts.map((p) => [p.id, p]));
  return entries
    .map((e) => {
      const p = byId.get(e.postId);
      // The Post body carries the title as its first line (a Post has no title
      // column); the title is rendered separately below, so strip the prefix or
      // the admin list shows it twice.
      return p ? { ...postSummary(p), title: e.title, body: stripAnnouncementTitle(p.body, e.title) } : null;
    })
    .filter(Boolean);
}

export async function createPlatformAnnouncement(
  actor: Actor,
  input: AdminAnnouncementCreateInput,
  ctx: MutationCtx = {}
) {
  assertAdmin(actor);
  const post = await db.post.create<PostWithAuthor>({
    data: {
      authorId: actor.id,
      body: input.title ? `${input.title}\n\n${input.body}` : input.body,
      visibility: "PUBLIC",
    },
    include: { author: true },
  });
  const entries = await readAnnouncementEntries();
  entries.unshift({
    postId: post.id,
    title: input.title ?? null,
    createdAt: new Date().toISOString(),
    createdById: actor.id,
  });
  await writeAnnouncementEntries(entries.slice(0, MAX_ANNOUNCEMENTS), actor.id);
  await writeAuditLog({
    actorId: actor.id,
    action: "admin.announcement_create",
    entityType: "post",
    entityId: post.id,
    metadata: { title: input.title ?? null },
    ipAddress: ctx.ip,
  });
  return { ...postSummary(post), title: input.title ?? null };
}

export async function deletePlatformAnnouncement(
  actor: Actor,
  id: string,
  deleteContent: boolean,
  ctx: MutationCtx = {}
) {
  assertAdmin(actor);
  const entries = await readAnnouncementEntries();
  const remaining = entries.filter((e) => e.postId !== id);
  if (remaining.length === entries.length) throw new NotFoundError("Announcement not found");
  await writeAnnouncementEntries(remaining, actor.id);
  if (deleteContent) {
    await db.post.update({ where: { id }, data: { deletedAt: new Date() } }).catch(() => null);
  }
  await writeAuditLog({
    actorId: actor.id,
    action: "admin.announcement_delete",
    entityType: "post",
    entityId: id,
    metadata: { deleteContent },
    ipAddress: ctx.ip,
  });
  return { ok: true as const };
}
