/**
 * lib/services/teams.ts — team domain logic (Backend Engineer B).
 *
 * Teams live inside companies. Company MANAGER+ manages teams; company
 * membership is required to view them. Team roles never grant company power.
 */
import { prisma } from "@/lib/db";

/** Typed DB facade (pre-generation stand-in; real client later). */
const db = prisma as unknown as PrismaClientLike;
import {
  ConflictError,
  NotFoundError,
} from "@/lib/api";
import {
  requireCompanyManager,
  requireCompanyMember,
} from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit";
import type {
  Actor,
  Company,
  ConversationWithMembers,
  PrismaClientLike,
  Team,
  TeamMemberWithUser,
} from "@/lib/prisma-types";
import { publicTeam, publicUser, teamMemberView } from "./serialize";
import type {
  TeamCreateInput,
  TeamMemberAddInput,
  TeamMemberRoleInput,
  TeamUpdateInput,
} from "@/lib/validation";
import type { PageOpts } from "./companies";

interface MutationCtx {
  ip?: string | null;
}

async function getTeamOrThrow(teamId: string): Promise<Team> {
  const team = await db.team.findUnique({ where: { id: teamId } });
  if (!team) throw new NotFoundError("Team not found");
  return team;
}

/** All team endpoints first resolve the team, then scope by its company. */
async function teamCompany(teamId: string): Promise<Team> {
  const team = await getTeamOrThrow(teamId);
  const company = await db.company.findUnique({ where: { id: team.companyId } });
  if (!company || !company.isActive) throw new NotFoundError("Team not found");
  return team;
}

export async function listTeams(actor: Actor, companyId?: string) {
  if (companyId) {
    await requireCompanyMember(actor.id, companyId);
    const teams = await db.team.findMany<Team & { _count: { members: number } }>({
      where: { companyId },
      include: { _count: { select: { members: true } } },
      orderBy: { name: "asc" },
    });
    return teams.map(publicTeam);
  }
  // All teams across companies the actor belongs to.
  const memberships = await db.companyMember.findMany({
    where: { userId: actor.id },
    select: { companyId: true },
  });
  const companyIds = memberships.map((m) => m.companyId);
  if (companyIds.length === 0) return [];
  const teams = await db.team.findMany<
    Team & { _count: { members: number }; company: Company }
  >({
    where: { companyId: { in: companyIds } },
    include: { _count: { select: { members: true } }, company: true },
    orderBy: { name: "asc" },
  });
  return teams
    .filter((t) => (t.company as { isActive: boolean } | undefined)?.isActive !== false)
    .map((t) => ({ ...publicTeam(t), companyId: t.companyId }));
}

export async function createTeam(
  actor: Actor,
  companyId: string,
  input: TeamCreateInput,
  ctx: MutationCtx = {}
) {
  await requireCompanyManager(actor.id, companyId);
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company || !company.isActive) throw new NotFoundError("Company not found");
  const existing = await db.team.findUnique({
    where: { companyId_name: { companyId, name: input.name } },
  });
  if (existing) throw new ConflictError("TEAM_EXISTS", "A team with this name already exists");
  const team = await db.$transaction(async (tx) => {
    const created = await tx.team.create({
      data: { companyId, name: input.name, description: input.description ?? null },
    });
    // Creator joins as team MANAGER.
    await tx.teamMember.create({
      data: { teamId: created.id, userId: actor.id, role: "MANAGER" },
    });
    return created;
  });
  await writeAuditLog({
    actorId: actor.id,
    action: "team.create",
    entityType: "company",
    entityId: companyId,
    metadata: { teamId: team.id, name: team.name },
    ipAddress: ctx.ip,
  });
  return { ...publicTeam({ ...team, _count: { members: 1 } } as Parameters<typeof publicTeam>[0]) };
}

export async function getTeam(actor: Actor, teamId: string) {
  const team = await teamCompany(teamId);
  await requireCompanyMember(actor.id, team.companyId);
  const [memberCount, members] = await Promise.all([
    db.teamMember.count({ where: { teamId } }),
    db.teamMember.findMany<TeamMemberWithUser>({
      where: { teamId },
      include: { user: true },
      orderBy: { joinedAt: "asc" },
      take: 50,
    }),
  ]);
  return {
    team: { ...publicTeam(team), memberCount },
    members: members.map(teamMemberView),
  };
}

export async function updateTeam(
  actor: Actor,
  teamId: string,
  input: TeamUpdateInput,
  ctx: MutationCtx = {}
) {
  const team = await teamCompany(teamId);
  await requireCompanyManager(actor.id, team.companyId);
  if (input.name) {
    const clash = await db.team.findUnique({
      where: { companyId_name: { companyId: team.companyId, name: input.name } },
    });
    if (clash && clash.id !== teamId) {
      throw new ConflictError("TEAM_EXISTS", "A team with this name already exists");
    }
  }
  const updated = await db.team.update({
    where: { id: teamId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
  await writeAuditLog({
    actorId: actor.id,
    action: "team.update",
    entityType: "company",
    entityId: team.companyId,
    metadata: { teamId, fields: Object.keys(input) },
    ipAddress: ctx.ip,
  });
  return { team: publicTeam(updated) };
}

export async function deleteTeam(actor: Actor, teamId: string, ctx: MutationCtx = {}) {
  const team = await teamCompany(teamId);
  await requireCompanyManager(actor.id, team.companyId);
  await db.team.delete({ where: { id: teamId } });
  await writeAuditLog({
    actorId: actor.id,
    action: "team.delete",
    entityType: "company",
    entityId: team.companyId,
    metadata: { teamId, name: team.name },
    ipAddress: ctx.ip,
  });
  return { ok: true as const };
}

export async function listTeamMembers(actor: Actor, teamId: string, opts: PageOpts) {
  const team = await teamCompany(teamId);
  await requireCompanyMember(actor.id, team.companyId);
  // Teams are small: offset paging is fine here.
  const offset = opts.cursor ? parseInt(opts.cursor, 10) || 0 : 0;
  const members = await db.teamMember.findMany<TeamMemberWithUser>({
    where: { teamId },
    include: { user: true },
    orderBy: [{ joinedAt: "asc" }],
    take: opts.limit + 1,
    skip: offset,
  });
  const page = members.slice(0, opts.limit);
  return {
    data: page.map(teamMemberView),
    nextCursor: members.length > opts.limit ? String(offset + opts.limit) : null,
  };
}

export async function addTeamMember(
  actor: Actor,
  teamId: string,
  input: TeamMemberAddInput,
  ctx: MutationCtx = {}
) {
  const team = await teamCompany(teamId);
  await requireCompanyManager(actor.id, team.companyId);
  // Team members must be company members first.
  const companyMembership = await db.companyMember.findUnique({
    where: { companyId_userId: { companyId: team.companyId, userId: input.userId } },
  });
  if (!companyMembership) {
    throw new ConflictError("NOT_COMPANY_MEMBER", "User must be a company member first");
  }
  const target = await db.user.findUnique({ where: { id: input.userId } });
  if (!target || target.deletedAt || !target.isActive) throw new NotFoundError("User not found");
  const existing = await db.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: input.userId } },
  });
  if (existing) throw new ConflictError("ALREADY_MEMBER", "User is already on this team");
  const created = await db.teamMember.create<TeamMemberWithUser>({
    data: { teamId, userId: input.userId, role: input.role },
    include: { user: true },
  });
  await writeAuditLog({
    actorId: actor.id,
    action: "team.member_add",
    entityType: "company",
    entityId: team.companyId,
    metadata: { teamId, targetUserId: input.userId, role: input.role },
    ipAddress: ctx.ip,
  });
  return teamMemberView(created);
}

export async function removeTeamMember(
  actor: Actor,
  teamId: string,
  targetUserId: string,
  ctx: MutationCtx = {}
) {
  const team = await teamCompany(teamId);
  const target = await db.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: targetUserId } },
  });
  if (!target) throw new NotFoundError("Team membership not found");
  const selfLeave = actor.id === targetUserId;
  if (!selfLeave) {
    await requireCompanyManager(actor.id, team.companyId);
  } else {
    await requireCompanyMember(actor.id, team.companyId);
  }
  await db.teamMember.delete({
    where: { teamId_userId: { teamId, userId: targetUserId } },
  });
  await writeAuditLog({
    actorId: actor.id,
    action: "team.member_remove",
    entityType: "company",
    entityId: team.companyId,
    metadata: { teamId, targetUserId, selfLeave },
    ipAddress: ctx.ip,
  });
  return { ok: true as const };
}

export async function updateTeamMember(
  actor: Actor,
  teamId: string,
  targetUserId: string,
  input: TeamMemberRoleInput,
  ctx: MutationCtx = {}
) {
  const team = await teamCompany(teamId);
  await requireCompanyManager(actor.id, team.companyId);
  const membership = await db.teamMember.findUnique<TeamMemberWithUser>({
    where: { teamId_userId: { teamId, userId: targetUserId } },
    include: { user: true },
  });
  if (!membership) throw new NotFoundError("Team membership not found");
  await db.teamMember.update({
    where: { teamId_userId: { teamId, userId: targetUserId } },
    data: { role: input.role },
  });
  await writeAuditLog({
    actorId: actor.id,
    action: "team.member_role_change",
    entityType: "company",
    entityId: team.companyId,
    metadata: { teamId, targetUserId, role: input.role },
    ipAddress: ctx.ip,
  });
  return { user: publicUser(membership.user), role: input.role };
}

/**
 * Team chat hookup: returns the team's group conversation, creating it on
 * first use. The conversation is linked to the company; all current team
 * members are added (actor becomes OWNER). Later team joins do NOT auto-join
 * the chat in v1 (documented limitation).
 */
export async function teamChat(actor: Actor, teamId: string, ctx: MutationCtx = {}) {
  const team = await teamCompany(teamId);
  await requireCompanyManager(actor.id, team.companyId);

  const existing = await db.conversation.findFirst<ConversationWithMembers>({
    where: { type: "GROUP", companyId: team.companyId, title: team.name },
    include: { members: { include: { user: true } } },
  });
  if (existing) {
    return { conversationId: existing.id, created: false as const };
  }

  const teamMembers = await db.teamMember.findMany({
    where: { teamId },
    select: { userId: true },
  });
  const memberIds = [...new Set([actor.id, ...teamMembers.map((m) => m.userId)])];

  const conversation = await db.$transaction(async (tx) => {
    const convo = await tx.conversation.create({
      data: {
        type: "GROUP",
        title: team.name,
        companyId: team.companyId,
        createdById: actor.id,
      },
    });
    for (const userId of memberIds) {
      await tx.conversationMember.create({
        data: {
          conversationId: convo.id,
          userId,
          role: userId === actor.id ? "OWNER" : "MEMBER",
        },
      });
    }
    return convo;
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "team.chat_create",
    entityType: "company",
    entityId: team.companyId,
    metadata: { teamId, conversationId: conversation.id },
    ipAddress: ctx.ip,
  });
  return { conversationId: conversation.id, created: true as const };
}

/** Company-scoped team list (used by /api/companies/[id]/teams). */
export async function listCompanyTeams(actor: Actor, companyId: string) {
  await requireCompanyMember(actor.id, companyId);
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company || !company.isActive) throw new NotFoundError("Company not found");
  const teams = await db.team.findMany<Team & { _count: { members: number } }>({
    where: { companyId },
    include: { _count: { select: { members: true } } },
    orderBy: { name: "asc" },
  });
  return teams.map(publicTeam);
}
