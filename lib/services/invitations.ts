/**
 * lib/services/invitations.ts — company invitations (Backend Engineer B).
 *
 * Flow: manager enters an email → validated → expiring invitation row (raw
 * token emailed, only SHA-256 stored) → invite link /invite/<token>.
 * Accept requires a session whose account email matches the invite email;
 * recipients without an account complete signup first, the token carries them
 * through (the link lands on /invite/[token], which prompts register/login).
 */
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/db";

/** Typed DB facade (pre-generation stand-in; real client later). */
const db = prisma as unknown as PrismaClientLike;
import {
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
} from "@/lib/api";
import {
  getCompanyMembership,
  requireCompanyManager,
} from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit";
import { getMailer, Templates } from "@/lib/mailer";
import type {
  Actor,
  CompanyRole,
  Invitation,
  InvitationFull,
  PrismaClientLike,
} from "@/lib/prisma-types";
import { invitationView } from "./serialize";
import { assertRoleAssignableByManager } from "./company-role-policy";
import { assertRoomForAnotherCompany } from "./companies";
import type { InvitationCreateInput } from "@/lib/validation";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface MutationCtx {
  ip?: string | null;
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

async function getActiveCompany(companyId: string) {
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company || !company.isActive) throw new NotFoundError("Company not found");
  return company;
}

/**
 * Resolve an invitation by raw token OR by invitation id (managers holding
 * the id from the pending list can resend/revoke without the raw token).
 */
async function findInvitation(ref: string) {
  const byId = await db.invitation.findUnique<InvitationFull>({
    where: { id: ref },
    include: { company: true, team: true, invitedBy: true },
  });
  if (byId) return byId;
  return db.invitation.findUnique<InvitationFull>({
    where: { tokenHash: hashToken(ref) },
    include: { company: true, team: true, invitedBy: true },
  });
}

/** Mark expired invitations expired (idempotent, best-effort). */
async function expireIfNeeded(inv: Invitation): Promise<Invitation> {
  if (inv.status === "PENDING" && inv.expiresAt <= new Date()) {
    return db.invitation.update({
      where: { id: inv.id },
      data: { status: "EXPIRED" },
    });
  }
  return inv;
}

async function sendInvitationEmail(
  to: string,
  companyName: string,
  inviterName: string,
  rawToken: string
): Promise<void> {
  const tpl = Templates.invitation(companyName, inviterName, rawToken);
  await getMailer().send({ to, subject: tpl.subject, html: tpl.html, text: tpl.text, tag: "company-invite" });
}

// ─── Manager actions ────────────────────────────────────────────────────────

export async function createInvitation(
  actor: Actor,
  input: InvitationCreateInput,
  ctx: MutationCtx = {}
) {
  await requireCompanyManager(actor.id, input.companyId);
  const company = await getActiveCompany(input.companyId);
  // An invitation can only offer MEMBER: no owner, and no manager — the Manager
  // role is granted from the admin console. See company-role-policy.ts.
  assertRoleAssignableByManager(input.role);

  const email = input.email.toLowerCase();
  if (email === actorEmail(actor)) {
    // Inviting yourself is a no-op; surface as conflict, not silent success.
    throw new ConflictError("SELF_INVITE", "You are already a member of this company");
  }

  let teamId: string | null = null;
  if (input.teamId) {
    const team = await db.team.findUnique({ where: { id: input.teamId } });
    if (!team || team.companyId !== input.companyId) {
      throw new NotFoundError("Team not found in this company");
    }
    teamId = team.id;
  }

  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) {
    const already = await getCompanyMembership(existingUser.id, input.companyId);
    if (already) throw new ConflictError("ALREADY_MEMBER", "This user is already a member");
  }

  const pending = await db.invitation.findFirst({
    where: { companyId: input.companyId, email, status: "PENDING" },
  });
  if (pending) {
    throw new ConflictError("INVITATION_EXISTS", "A pending invitation already exists for this email");
  }

  const raw = randomBytes(32).toString("hex");
  const invitation = await db.invitation.create<InvitationFull>({
    data: {
      companyId: input.companyId,
      teamId,
      email,
      role: input.role,
      tokenHash: hashToken(raw),
      invitedById: actor.id,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
    include: { company: true, team: true, invitedBy: true },
  });

  await sendInvitationEmail(email, company.name, actorName(actor), raw);

  await writeAuditLog({
    actorId: actor.id,
    action: "invitation.create",
    entityType: "company",
    entityId: input.companyId,
    metadata: { invitationId: invitation.id, email, role: input.role, teamId },
    ipAddress: ctx.ip,
  });

  return { invitation: invitationView(invitation) };
}

export async function listInvitations(actor: Actor, companyId?: string) {
  if (companyId) {
    await requireCompanyManager(actor.id, companyId);
    const rows = await db.invitation.findMany<InvitationFull>({
      where: { companyId, status: "PENDING" },
      include: { company: true, team: true, invitedBy: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(invitationView);
  }
  // Pending invitations across every company the actor manages.
  const managed = await db.companyMember.findMany({
    where: { userId: actor.id, role: { in: ["OWNER", "MANAGER"] } },
    select: { companyId: true },
  });
  const ids = managed.map((m) => m.companyId);
  if (ids.length === 0) return [];
  const rows = await db.invitation.findMany<InvitationFull>({
    where: { companyId: { in: ids }, status: "PENDING" },
    include: { company: true, team: true, invitedBy: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(invitationView);
}

/** Validate a token → invitation preview (public; the token is the credential). */
export async function validateInvitationToken(rawToken: string) {
  const inv = await findInvitation(rawToken);
  if (!inv) throw new NotFoundError("Invitation not found");
  const current = await expireIfNeeded(inv);
  if (current.status !== "PENDING") {
    throw new GoneError(
      current.status === "EXPIRED" ? "This invitation has expired" : "This invitation is no longer valid"
    );
  }
  return { invitation: invitationView({ ...inv, status: current.status }) };
}

export async function resendInvitation(actor: Actor, ref: string, ctx: MutationCtx = {}) {
  const inv = await findInvitation(ref);
  if (!inv) throw new NotFoundError("Invitation not found");
  await requireCompanyManager(actor.id, inv.companyId);
  const current = await expireIfNeeded(inv);
  if (current.status === "ACCEPTED" || current.status === "REVOKED") {
    throw new ConflictError("INVITATION_CLOSED", "This invitation can no longer be resent");
  }
  const raw = randomBytes(32).toString("hex");
  const updated = await db.invitation.update<InvitationFull>({
    where: { id: inv.id },
    data: {
      tokenHash: hashToken(raw),
      status: "PENDING",
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
    include: { company: true, team: true, invitedBy: true },
  });
  await sendInvitationEmail(updated.email, updated.company.name, actorName(actor), raw);
  await writeAuditLog({
    actorId: actor.id,
    action: "invitation.resend",
    entityType: "company",
    entityId: inv.companyId,
    metadata: { invitationId: inv.id, email: inv.email },
    ipAddress: ctx.ip,
  });
  return { invitation: invitationView(updated) };
}

export async function revokeInvitation(actor: Actor, ref: string, ctx: MutationCtx = {}) {
  const inv = await findInvitation(ref);
  if (!inv) throw new NotFoundError("Invitation not found");
  await requireCompanyManager(actor.id, inv.companyId);
  if (inv.status !== "PENDING" && inv.status !== "EXPIRED") {
    throw new ConflictError("INVITATION_CLOSED", "This invitation is already closed");
  }
  await db.invitation.update({ where: { id: inv.id }, data: { status: "REVOKED" } });
  await writeAuditLog({
    actorId: actor.id,
    action: "invitation.revoke",
    entityType: "company",
    entityId: inv.companyId,
    metadata: { invitationId: inv.id, email: inv.email },
    ipAddress: ctx.ip,
  });
  return { ok: true as const };
}

// ─── Accept (invitee, authenticated) ─────────────────────────────────────────

export async function acceptInvitation(actor: Actor, rawToken: string, ctx: MutationCtx = {}) {
  const inv = await findInvitation(rawToken);
  if (!inv) throw new NotFoundError("Invitation not found");
  const current = await expireIfNeeded(inv);
  if (current.status !== "PENDING") {
    throw new GoneError(
      current.status === "EXPIRED" ? "This invitation has expired" : "This invitation is no longer valid"
    );
  }
  const company = await getActiveCompany(inv.companyId);

  // The invite email must match the account email (case-insensitive).
  const me = await db.user.findUnique({ where: { id: actor.id } });
  if (!me || me.email.toLowerCase() !== inv.email.toLowerCase()) {
    throw new ForbiddenError(
      "EMAIL_MISMATCH",
      "This invitation was sent to a different email address"
    );
  }

  const existing = await getCompanyMembership(actor.id, inv.companyId);
  if (existing) {
    // Idempotent: already a member → close the invitation, return membership.
    await db.invitation.update({ where: { id: inv.id }, data: { status: "ACCEPTED" } });
    return { companyId: inv.companyId, role: existing.role, alreadyMember: true as const };
  }

  // Accepting is a membership grant, so the cap binds it like every other one.
  // Checked before the transaction: a refusal must leave the invitation PENDING
  // so the person can still be moved to another company and accept then.
  await assertRoomForAnotherCompany(actor.id, actor.platformRole, "self");

  const role: CompanyRole = inv.role;
  await db.$transaction(async (tx) => {
    await tx.companyMember.create({
      data: { companyId: inv.companyId, userId: actor.id, role },
    });
    if (inv.teamId) {
      // Team may have been deleted since the invite; skip silently then.
      const team = await tx.team.findUnique({ where: { id: inv.teamId } });
      if (team && team.companyId === inv.companyId) {
        await tx.teamMember.create({
          data: { teamId: team.id, userId: actor.id, role: "MEMBER" },
        });
      }
    }
    await tx.invitation.update({ where: { id: inv.id }, data: { status: "ACCEPTED" } });
    // Notify the inviter.
    await tx.notification.create({
      data: {
        userId: inv.invitedById,
        actorId: actor.id,
        type: "INVITATION_ACCEPTED",
        entityType: "company",
        entityId: inv.companyId,
        title: "Invitation accepted",
        body: `${me.name} joined ${company.name}`,
      },
    });
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "invitation.accept",
    entityType: "company",
    entityId: inv.companyId,
    metadata: { invitationId: inv.id, role },
    ipAddress: ctx.ip,
  });

  return { companyId: inv.companyId, role, alreadyMember: false as const };
}

// ─── Small helpers ──────────────────────────────────────────────────────────

function actorName(actor: Actor): string {
  return actor.name || "A company manager";
}

function actorEmail(actor: Actor): string {
  return (actor.email || "").toLowerCase();
}
