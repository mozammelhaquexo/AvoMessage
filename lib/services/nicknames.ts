/**
 * lib/services/nicknames.ts — what people are called.
 *
 * TWO DIFFERENT FEATURES LIVE HERE, and they are deliberately kept apart
 * because they have different owners and different visibility:
 *
 *   `ContactNickname` — a PRIVATE rename. `ownerId` gives `targetId` a name
 *   that only `ownerId` ever sees. The target is never told, nothing about the
 *   target changes for anyone else, and the row disappears with either user.
 *   This is the "messenger e user er nickname dewa jabe" request: in a DM you
 *   can call someone whatever you actually know them as.
 *
 *   `ConversationMember.nickname` — a member's OWN name inside one group,
 *   visible to everyone in that group. This is the "group er member ra nijer
 *   nickname dite parbe" request.
 *
 * RESOLUTION ORDER, when the UI asks what to show for a member: the viewer's
 * private rename, then the member's own group nickname, then the real name.
 * The rule itself lives in `lib/display-name.ts` (dependency-free, so the
 * serializer can use it without importing this module and creating a cycle);
 * this file is only the storage and authorization around it.
 */
import { prisma } from "@/lib/db";
import type { PrismaClientLike, Actor, ContactNickname, User } from "@/lib/prisma-types";

/** Typed DB facade (pre-generation stand-in; real client later). */
const db = prisma as unknown as PrismaClientLike;

import { NotFoundError, ValidationError } from "@/lib/api";
import { requireConversationMember } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit";
import { publicUser } from "./serialize";
import type { ContactNicknameInput, MemberNicknameInput } from "@/lib/validation";

interface MutationCtx {
  ip?: string | null;
}

/**
 * The viewer's private renames for a set of people, as a lookup.
 *
 * One query for a whole conversation rather than one per member: a 50-member
 * group would otherwise issue 50 round trips just to render the member list.
 * Self is excluded — you cannot rename yourself, and the service rejects it.
 */
export async function contactNicknamesFor(
  ownerId: string,
  targetIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(targetIds)].filter((id) => id !== ownerId);
  if (unique.length === 0) return new Map();

  const rows = await db.contactNickname.findMany({
    where: { ownerId, targetId: { in: unique } },
    select: { targetId: true, nickname: true },
  });
  return new Map(rows.map((row) => [row.targetId, row.nickname]));
}

/** Everyone the caller has privately renamed. */
export async function listContactNicknames(actor: Actor) {
  const rows = await db.contactNickname.findMany<ContactNickname & { target: User }>({
    where: { ownerId: actor.id },
    include: { target: true },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((row) => ({
    user: publicUser(row.target),
    nickname: row.nickname,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * Set or clear the caller's private name for someone.
 *
 * `nickname: null` clears it. This is the only write path for a contact
 * nickname — the DELETE route calls straight into it — so "clear" and "set"
 * cannot drift apart.
 */
export async function setContactNickname(
  actor: Actor,
  input: ContactNicknameInput,
  ctx: MutationCtx = {},
) {
  if (input.userId === actor.id) {
    throw new ValidationError("You cannot give yourself a nickname", {
      userId: ["Choose somebody else"],
    });
  }

  const target = await db.user.findUnique({ where: { id: input.userId } });
  if (!target || !target.isActive || target.deletedAt) {
    throw new NotFoundError("User not found");
  }

  if (input.nickname === null) {
    await db.contactNickname.deleteMany({
      where: { ownerId: actor.id, targetId: input.userId },
    });
  } else {
    await db.contactNickname.upsert({
      where: { ownerId_targetId: { ownerId: actor.id, targetId: input.userId } },
      create: { ownerId: actor.id, targetId: input.userId, nickname: input.nickname },
      update: { nickname: input.nickname },
    });
  }

  /*
   * Deliberately no `targetId` in the metadata and no audit entry on the
   * target: this is a private label, and an audit trail is read by admins. The
   * action is recorded against the OWNER so the write is accountable, without
   * disclosing who was renamed or to what.
   */
  await writeAuditLog({
    actorId: actor.id,
    action: input.nickname === null ? "nickname.contact.clear" : "nickname.contact.set",
    entityType: "user",
    entityId: actor.id,
    metadata: { cleared: input.nickname === null },
    ipAddress: ctx.ip,
  });

  return { userId: input.userId, nickname: input.nickname };
}

/**
 * Set or clear the caller's own name inside one group.
 *
 * Groups only. In a 1:1 conversation a nickname would silently change what the
 * OTHER person sees, which is a surprising thing for a private action to do —
 * and the private contact nickname already covers the DM case, from the side
 * that should own it.
 */
export async function setMemberNickname(
  actor: Actor,
  conversationId: string,
  input: MemberNicknameInput,
  ctx: MutationCtx = {},
) {
  await requireConversationMember(actor.id, conversationId);

  const convo = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!convo) throw new NotFoundError("Conversation not found");
  if (convo.type !== "GROUP") {
    throw new ValidationError("Nicknames are only available in group chats", {
      conversationId: ["Not a group conversation"],
    });
  }

  const updated = await db.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId: actor.id } },
    data: { nickname: input.nickname },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: input.nickname === null ? "nickname.member.clear" : "nickname.member.set",
    entityType: "conversation",
    entityId: conversationId,
    metadata: { cleared: input.nickname === null },
    ipAddress: ctx.ip,
  });

  return { conversationId, nickname: updated.nickname };
}
