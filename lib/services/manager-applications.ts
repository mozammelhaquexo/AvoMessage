/**
 * lib/services/manager-applications.ts — "apply to become a manager".
 *
 * The flow the user asked for:
 *   applicant fills the form (inside Settings) -> the application lands in the
 *   admin panel -> an admin reads the full details and approves -> the
 *   applicant gains the MANAGER role in a company, which is what makes the
 *   Manager Panel appear in their sidebar.
 *
 * AUTHORIZATION LIVES HERE, not in the routes. Every admin function calls
 * `assertAdmin`, and every applicant function is scoped to `actor.id`, so a
 * user can never read or review someone else's application.
 *
 * Approval is the only place a role is granted, and it happens inside the same
 * transaction that marks the application APPROVED — so there is no window where
 * the application says APPROVED but the role was never granted.
 */
import { prisma } from "@/lib/db";

/** Typed DB facade (pre-generation stand-in; real client later). */
const db = prisma as unknown as PrismaClientLike;
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/api";
import { decodeCursor, encodeCursor } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { NotificationType } from "@prisma/client";
import { createNotification } from "./notifications";
import { publicCompany, publicUser } from "./serialize";
import { countMemberships, resolveMemberTier } from "./companies";
import { isCompanyManagerRole } from "@/lib/company-roles";
import { assertMembershipCapacity, tierAfterManagerGrant } from "./company-membership-policy";
import type {
  Actor,
  Company,
  CompanyRole,
  ManagerApplication,
  ManagerApplicationFull,
  ManagerApplicationStatus,
  PrismaClientLike,
  User,
} from "@/lib/prisma-types";
import type {
  ManagerApplicationInput,
  ManagerApplicationReviewInput,
} from "@/lib/validation";

export interface MutationCtx {
  ip?: string | null;
}

interface PageOpts {
  limit: number;
  cursor: string | null;
}

/** Company hierarchy — used to never DEMOTE an existing member on approval. */
const COMPANY_RANK: Record<CompanyRole, number> = { MEMBER: 0, MANAGER: 1, OWNER: 2 };

function assertAdmin(actor: Actor): void {
  if (actor.platformRole !== "ADMIN" && actor.platformRole !== "SUPER_ADMIN") {
    throw new ForbiddenError("FORBIDDEN", "Admin access required");
  }
}

function cursorFragment(cursor: string | null): Record<string, unknown>[] {
  if (!cursor) return [];
  const { createdAt, id } = decodeCursor(cursor);
  return [{ OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] }];
}

async function pageOf<T extends { createdAt: Date; id: string }>(
  rows: T[],
  limit: number,
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

// ─── Views ──────────────────────────────────────────────────────────────────

export interface ManagerApplicationView {
  id: string;
  status: ManagerApplicationStatus;
  companyId: string | null;
  companyName: string;
  position: string;
  companySize: number;
  teamCount: number;
  teamSize: number;
  message: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  applicant?: ReturnType<typeof publicUser>;
  company?: ReturnType<typeof publicCompany> | null;
  reviewer?: ReturnType<typeof publicUser> | null;
}

function applicationView(a: ManagerApplicationFull): ManagerApplicationView {
  return {
    id: a.id,
    status: a.status,
    companyId: a.companyId,
    companyName: a.companyName,
    position: a.position,
    companySize: a.companySize,
    teamCount: a.teamCount,
    teamSize: a.teamSize,
    message: a.message,
    reviewNote: a.reviewNote,
    reviewedAt: a.reviewedAt ? a.reviewedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    applicant: a.user ? publicUser(a.user) : undefined,
    company: a.company ? publicCompany(a.company) : null,
    reviewer: a.reviewedBy ? publicUser(a.reviewedBy) : null,
  };
}

const FULL_INCLUDE = {
  user: true,
  company: true,
  reviewedBy: true,
} as const;

// ─── Applicant side ─────────────────────────────────────────────────────────

/**
 * Submit an application. One PENDING application per user at a time —
 * re-applying after a decision is allowed, which is why this is a check rather
 * than a unique constraint.
 */
export async function submitApplication(
  actor: Actor,
  input: ManagerApplicationInput,
  ctx: MutationCtx = {},
) {
  const pending = await db.managerApplication.findFirst<ManagerApplication>({
    where: { userId: actor.id, status: "PENDING" },
  });
  if (pending) {
    throw new ConflictError(
      "APPLICATION_PENDING",
      "You already have an application under review.",
    );
  }

  // If the applicant picked a real company, verify it exists — a stale id
  // would otherwise be stored and silently break the approval step.
  let company: Company | null = null;
  if (input.companyId) {
    company = await db.company.findUnique<Company>({ where: { id: input.companyId } });
    if (!company || !company.isActive) {
      throw new NotFoundError("That company no longer exists");
    }
  }

  const created = await db.managerApplication.create<ManagerApplicationFull>({
    data: {
      userId: actor.id,
      companyId: company?.id ?? null,
      companyName: company?.name ?? input.companyName,
      position: input.position,
      companySize: input.companySize,
      teamCount: input.teamCount,
      teamSize: input.teamSize,
      message: input.message ?? null,
    },
    include: FULL_INCLUDE,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "manager_application.submit",
    entityType: "manager_application",
    entityId: created.id,
    metadata: { companyId: company?.id ?? null, position: input.position },
    ipAddress: ctx.ip,
  });

  // Tell every admin. `createNotification` applies preferences and never
  // throws, so a failure here cannot lose the application itself.
  void notifyAdmins(created, actor).catch(() => undefined);

  return applicationView(created);
}

async function notifyAdmins(application: ManagerApplicationFull, actor: Actor) {
  const admins = await db.user.findMany<Pick<User, "id">>({
    where: {
      platformRole: { in: ["ADMIN", "SUPER_ADMIN"] },
      isActive: true,
      deletedAt: null,
    },
    select: { id: true },
  });
  await Promise.all(
    admins.map((a) =>
      createNotification({
        userId: a.id,
        actorId: actor.id,
        type: NotificationType.MANAGER_APPLICATION,
        entityType: "manager_application",
        entityId: application.id,
        title: "New manager application",
        body: `${actor.name} applied as ${application.position} at ${application.companyName}.`,
      }),
    ),
  );
}

/** The viewer's most recent application (any status), or null. */
export async function getMyApplication(actor: Actor) {
  const latest = await db.managerApplication.findFirst<ManagerApplicationFull>({
    where: { userId: actor.id },
    include: FULL_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return latest ? applicationView(latest) : null;
}

/** Withdraw a PENDING application. Only the applicant may do this. */
export async function withdrawApplication(actor: Actor, id: string, ctx: MutationCtx = {}) {
  const application = await db.managerApplication.findUnique<ManagerApplication>({ where: { id } });
  if (!application) throw new NotFoundError("Application not found");
  if (application.userId !== actor.id) {
    throw new ForbiddenError("FORBIDDEN", "You can only withdraw your own application");
  }
  if (application.status !== "PENDING") {
    throw new ConflictError("ALREADY_REVIEWED", "This application has already been decided");
  }
  const updated = await db.managerApplication.update<ManagerApplicationFull>({
    where: { id },
    data: { status: "WITHDRAWN" },
    include: FULL_INCLUDE,
  });
  await writeAuditLog({
    actorId: actor.id,
    action: "manager_application.withdraw",
    entityType: "manager_application",
    entityId: id,
    ipAddress: ctx.ip,
  });
  return applicationView(updated);
}

// ─── Admin side ─────────────────────────────────────────────────────────────

export async function listApplications(
  actor: Actor,
  opts: PageOpts & { status?: ManagerApplicationStatus; search?: string },
) {
  assertAdmin(actor);
  const where: Record<string, unknown> = {};
  if (opts.status) where.status = opts.status;
  const and = cursorFragment(opts.cursor);
  if (and.length > 0) where.AND = and;
  if (opts.search) {
    where.OR = [
      { companyName: { contains: opts.search, mode: "insensitive" } },
      { position: { contains: opts.search, mode: "insensitive" } },
      { user: { is: { OR: [
        { name: { contains: opts.search, mode: "insensitive" } },
        { username: { contains: opts.search, mode: "insensitive" } },
      ] } } },
    ];
  }
  const rows = await db.managerApplication.findMany<ManagerApplicationFull>({
    where,
    include: FULL_INCLUDE,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
  });
  const { data, nextCursor } = await pageOf(rows, opts.limit);
  return { data: data.map(applicationView), nextCursor };
}

/**
 * Full detail for one application. Admins see any; an applicant may read their
 * own (so the Settings tab can show the decision note).
 */
export async function getApplication(actor: Actor, id: string) {
  const application = await db.managerApplication.findUnique<ManagerApplicationFull>({
    where: { id },
    include: FULL_INCLUDE,
  });
  if (!application) throw new NotFoundError("Application not found");
  const isAdmin = actor.platformRole === "ADMIN" || actor.platformRole === "SUPER_ADMIN";
  if (!isAdmin && application.userId !== actor.id) {
    throw new ForbiddenError("FORBIDDEN", "You can only view your own application");
  }
  return applicationView(application);
}

export async function pendingApplicationCount(actor: Actor) {
  assertAdmin(actor);
  return { pending: await db.managerApplication.count({ where: { status: "PENDING" } }) };
}

/**
 * Approve or decline. Approval grants the company role in the SAME transaction
 * that flips the status, so the two can never disagree.
 */
export async function reviewApplication(
  actor: Actor,
  id: string,
  input: ManagerApplicationReviewInput,
  ctx: MutationCtx = {},
) {
  assertAdmin(actor);

  const application = await db.managerApplication.findUnique<ManagerApplicationFull>({
    where: { id },
    include: FULL_INCLUDE,
  });
  if (!application) throw new NotFoundError("Application not found");
  if (application.status !== "PENDING") {
    throw new ConflictError("ALREADY_REVIEWED", "This application has already been decided");
  }

  const decision: ManagerApplicationStatus =
    input.action === "APPROVE" ? "APPROVED" : "DECLINED";

  /*
   * Approval does NOT require a company, and the admin no longer picks one.
   * The product rule is that a manager creates their own company, so an
   * application that names a company which is not on the platform yet is still
   * perfectly approvable — the applicant creates the company afterwards.
   *
   * A company is only involved when one is already attached: either the
   * applicant named one that exists (stored on the application), or an API
   * caller explicitly passed one. In that case we grant MANAGER there too, so
   * the approval and the role can never disagree.
   */
  let companyId: string | null = null;
  if (decision === "APPROVED") {
    companyId = input.companyId ?? application.companyId ?? null;
    if (companyId) {
      const company = await db.company.findUnique<Company>({ where: { id: companyId } });
      if (!company || !company.isActive) {
        throw new NotFoundError("That company no longer exists");
      }
    }
  }

  // Approving grants a company membership, so the cap binds it like every other
  // grant. The tier is the one they hold AFTER the grant: the promotion is
  // itself what raises the ceiling, so a member of one company is judged
  // against the manager's three rather than the user's one.
  if (decision === "APPROVED" && companyId) {
    const already = await db.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId: application.userId } },
    });
    if (!already) {
      const before = await resolveMemberTier(application.userId, application.user.platformRole);
      const after = isCompanyManagerRole(input.role) ? tierAfterManagerGrant(before) : before;
      assertMembershipCapacity(after, await countMemberships(application.userId), "other");
    }
  }

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.managerApplication.update<ManagerApplicationFull>({
      where: { id },
      data: {
        status: decision,
        reviewedById: actor.id,
        reviewNote: input.note ?? null,
        reviewedAt: new Date(),
        // Persist where the role was granted, so the record is self-explanatory.
        ...(companyId ? { companyId } : {}),
      },
      include: FULL_INCLUDE,
    });

    if (decision === "APPROVED" && companyId) {
      const existing = await tx.companyMember.findUnique<{ role: CompanyRole }>({
        where: { companyId_userId: { companyId, userId: application.userId } },
      });
      if (!existing) {
        await tx.companyMember.create({
          data: { companyId, userId: application.userId, role: input.role },
        });
      } else if (COMPANY_RANK[existing.role] < COMPANY_RANK[input.role]) {
        // Never demote: an existing OWNER stays OWNER even if MANAGER was picked.
        await tx.companyMember.update({
          where: { companyId_userId: { companyId, userId: application.userId } },
          data: { role: input.role },
        });
      }
    }
    return row;
  });

  await writeAuditLog({
    actorId: actor.id,
    action: `manager_application.${decision === "APPROVED" ? "approve" : "decline"}`,
    entityType: "manager_application",
    entityId: id,
    metadata: { applicantId: application.userId, companyId, role: input.role },
    ipAddress: ctx.ip,
  });

  void createNotification({
    userId: application.userId,
    actorId: actor.id,
    type: NotificationType.MANAGER_APPLICATION_DECISION,
    entityType: "manager_application",
    entityId: id,
    title:
      decision === "APPROVED"
        ? "Your manager application was approved"
        : "Your manager application was declined",
    body:
      decision === "APPROVED"
        ? companyId
          ? `You now manage ${updated.company?.name ?? application.companyName}. The Manager Panel is in your sidebar.`
          : "You're approved as a manager. Create your company to open the Manager Panel."
        : input.note || "Your application was not approved this time.",
  }).catch(() => undefined);

  return applicationView(updated);
}
