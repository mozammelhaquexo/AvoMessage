/**
 * lib/services/conversations.ts — conversations domain (Backend Engineer B).
 *
 * Every read/write is scoped by conversation membership. DM creation dedupes
 * by exact member set and respects blocks either way.
 */
import { prisma } from "@/lib/db";

/** Typed DB facade (pre-generation stand-in; real client later). */
const db = prisma as unknown as PrismaClientLike;
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/api";
import {
  isBlockedEitherWay,
  requireConversationMember,
} from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit";
import { decodeCursor, encodeCursor } from "@/lib/api";
import type {
  Actor,
  Conversation,
  ConversationMember,
  ConversationType,
  ConversationWithMembers,
  MessageFull,
  PrismaClientLike,
} from "@/lib/prisma-types";
import {
  conversationMemberView,
  messageView,
  type ConversationView,
} from "./serialize";
import { contactNicknamesFor } from "./nicknames";
import type {
  ConversationCreateInput,
  ConversationMembersAddInput,
  ConversationMuteInput,
  ConversationReadInput,
  ConversationUpdateInput,
} from "@/lib/validation";
import type { PageOpts } from "./companies";

interface MutationCtx {
  ip?: string | null;
}

async function getConversationOrThrow(id: string): Promise<Conversation> {
  const convo = await db.conversation.findUnique({ where: { id } });
  if (!convo) throw new NotFoundError("Conversation not found");
  return convo;
}

async function assertActiveUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, isActive: true, deletedAt: true },
  });
  const ok = new Set(users.filter((u) => u.isActive && !u.deletedAt).map((u) => u.id));
  const missing = userIds.filter((id) => !ok.has(id));
  if (missing.length > 0) throw new NotFoundError("One or more users not found");
}

/** Assemble the list/detail view for one conversation + membership row. */
async function toConversationView(
  convo: Conversation & { members: Array<Parameters<typeof conversationMemberView>[0]> },
  selfMembership: { userId: string; lastReadAt: Date },
  opts: {
    withLastMessage: boolean;
    /**
     * The viewer's private renames, keyed by target id.
     *
     * Supplied by `listConversations`, which builds ONE map for the whole page.
     * Left undefined, this function fetches its own — correct for the
     * single-conversation callers, and the reason the list has to pass one:
     * the conversation list is polled, so a per-row lookup would add a round
     * trip per conversation to every poll.
     */
    contactNicknames?: Map<string, string>;
  }
): Promise<ConversationView> {
  let lastMessage: ConversationView["lastMessage"] = null;
  let unreadCount = 0;
  if (opts.withLastMessage) {
    const msg = await db.message.findFirst<MessageFull>({
      where: { conversationId: convo.id, deletedAt: null },
      include: { sender: true, attachments: true, reactions: true, voice: true },
      orderBy: { createdAt: "desc" },
    });
    if (msg) lastMessage = messageView(msg, selfMembership.userId);
    unreadCount = await db.message.count({
      where: {
        conversationId: convo.id,
        deletedAt: null,
        createdAt: { gt: selfMembership.lastReadAt },
        senderId: { not: selfMembership.userId },
      },
    });
  }
  /*
   * One lookup for the whole member list, so the viewer's private renames can
   * be applied in the same pass that builds the view. Resolving them HERE
   * rather than in each consumer is what keeps the chat header, the
   * conversation list, the forward dialog and the desktop notification from
   * disagreeing about what a given person is called.
   */
  const contactNicknames =
    opts.contactNicknames ??
    (await contactNicknamesFor(
      selfMembership.userId,
      convo.members.map((m) => m.userId)
    ));

  return {
    id: convo.id,
    type: convo.type,
    title: convo.title,
    avatarUrl: convo.avatarUrl,
    companyId: convo.companyId,
    members: convo.members.map((m) =>
      conversationMemberView(m, contactNicknames.get(m.userId) ?? null)
    ),
    lastMessage,
    unreadCount,
    lastMessageAt: convo.lastMessageAt.toISOString(),
  };
}

// ─── Queries ────────────────────────────────────────────────────────────────

export async function listConversations(actor: Actor, opts: PageOpts) {
  // Cursor pages on the conversation's lastMessageAt (DESC, id DESC tiebreak)
  // via a relation filter on the membership query.
  let convoFilter: Record<string, unknown> | undefined;
  if (opts.cursor) {
    const { createdAt, id } = decodeCursor(opts.cursor);
    convoFilter = {
      OR: [
        { lastMessageAt: { lt: createdAt } },
        { lastMessageAt: createdAt, id: { lt: id } },
      ],
    };
  }
  const memberships = await db.conversationMember.findMany<
    ConversationMember & { conversation: ConversationWithMembers }
  >({
    where: { userId: actor.id, ...(convoFilter ? { conversation: convoFilter } : {}) },
    include: { conversation: { include: { members: { include: { user: true } } } } },
    orderBy: [{ conversation: { lastMessageAt: "desc" } }, { conversationId: "desc" }],
    take: opts.limit + 1,
  });
  const page = memberships.slice(0, opts.limit);
  /*
   * ONE nickname query for the entire page, not one per conversation.
   *
   * This endpoint is polled (see lib/realtime/polling.ts), so a per-row lookup
   * would put a round trip per conversation on every tick — the kind of cost
   * that never shows up in a test with two conversations and hurts at thirty.
   */
  const contactNicknames = await contactNicknamesFor(
    actor.id,
    page.flatMap((m) => m.conversation.members.map((member) => member.userId))
  );
  const views = await Promise.all(
    page.map((m) =>
      toConversationView(m.conversation, m, { withLastMessage: true, contactNicknames })
    )
  );
  const nextCursor =
    memberships.length > opts.limit
      ? encodeCursor(
          new Date(page[page.length - 1].conversation.lastMessageAt),
          page[page.length - 1].conversationId
        )
      : null;
  return { data: views, nextCursor };
}

export async function getConversation(actor: Actor, id: string) {
  const membership = await requireConversationMember(actor.id, id);
  const convo = await db.conversation.findUnique<ConversationWithMembers>({
    where: { id },
    include: { members: { include: { user: true } } },
  });
  if (!convo) throw new NotFoundError("Conversation not found");
  return toConversationView(convo, membership, { withLastMessage: true });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export async function createConversation(
  actor: Actor,
  input: ConversationCreateInput,
  ctx: MutationCtx = {}
) {
  const type = input.type as ConversationType;
  const otherIds = [...new Set(input.userIds.filter((id) => id !== actor.id))];

  if (type === "DM") {
    if (otherIds.length !== 1) {
      throw new ConflictError("INVALID_DM", "DM conversations require exactly one other user");
    }
    const otherId = otherIds[0];
    await assertActiveUsers([otherId]);
    if (await isBlockedEitherWay(actor.id, otherId)) {
      throw new ForbiddenError("BLOCKED", "You cannot message this user");
    }
    // Dedupe by exact member set.
    const candidates = await db.conversation.findMany<ConversationWithMembers>({
      where: { type: "DM", members: { some: { userId: actor.id } } },
      include: { members: { include: { user: true } } },
    });
    const existing = candidates.find(
      (c) => c.members.length === 2 && c.members.some((m) => m.userId === otherId)
    );
    if (existing) {
      const self = existing.members.find((m) => m.userId === actor.id)!;
      return { conversation: await toConversationView(existing, self, { withLastMessage: true }), created: false as const };
    }
  } else {
    await assertActiveUsers(otherIds);
  }

  if (input.companyId) {
    const cm = await db.companyMember.findUnique({
      where: { companyId_userId: { companyId: input.companyId, userId: actor.id } },
    });
    if (!cm) throw new ForbiddenError("FORBIDDEN", "Company membership required");
    const company = await db.company.findUnique({ where: { id: input.companyId } });
    if (!company || !company.isActive) throw new NotFoundError("Company not found");
  }

  const conversation = await db.$transaction(async (tx) => {
    const convo = await tx.conversation.create({
      data: {
        type,
        title: type === "GROUP" ? (input.title ?? null) : null,
        companyId: input.companyId ?? null,
        createdById: actor.id,
      },
    });
    await tx.conversationMember.create({
      data: { conversationId: convo.id, userId: actor.id, role: "OWNER" },
    });
    for (const userId of otherIds) {
      await tx.conversationMember.create({
        data: { conversationId: convo.id, userId, role: "MEMBER" },
      });
    }
    return convo;
  });

  const full = await db.conversation.findUnique<ConversationWithMembers>({
    where: { id: conversation.id },
    include: { members: { include: { user: true } } },
  });
  const self = full!.members.find((m) => m.userId === actor.id)!;

  await writeAuditLog({
    actorId: actor.id,
    action: "conversation.create",
    entityType: "conversation",
    entityId: conversation.id,
    metadata: { type, companyId: input.companyId ?? null },
    ipAddress: ctx.ip,
  });

  return {
    conversation: await toConversationView(full!, self, { withLastMessage: false }),
    created: true as const,
  };
}

export async function updateConversation(
  actor: Actor,
  id: string,
  input: ConversationUpdateInput,
  ctx: MutationCtx = {}
) {
  const membership = await requireConversationMember(actor.id, id, "ADMIN");
  void membership;
  await getConversationOrThrow(id);
  const updated = await db.conversation.update<ConversationWithMembers>({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
    },
    include: { members: { include: { user: true } } },
  });
  const self = updated.members.find((m) => m.userId === actor.id)!;
  await writeAuditLog({
    actorId: actor.id,
    action: "conversation.update",
    entityType: "conversation",
    entityId: id,
    metadata: { fields: Object.keys(input) },
    ipAddress: ctx.ip,
  });
  return toConversationView(updated, self, { withLastMessage: true });
}

export async function deleteConversation(actor: Actor, id: string, ctx: MutationCtx = {}) {
  await requireConversationMember(actor.id, id, "OWNER");
  await getConversationOrThrow(id);
  await db.conversation.delete({ where: { id } });
  await writeAuditLog({
    actorId: actor.id,
    action: "conversation.delete",
    entityType: "conversation",
    entityId: id,
    metadata: {},
    ipAddress: ctx.ip,
  });
  return { ok: true as const };
}

export async function addConversationMembers(
  actor: Actor,
  id: string,
  input: ConversationMembersAddInput,
  ctx: MutationCtx = {}
) {
  await requireConversationMember(actor.id, id, "ADMIN");
  const convo = await getConversationOrThrow(id);
  if (convo.type === "DM") {
    throw new ConflictError("INVALID_DM", "Cannot add members to a DM");
  }
  const newIds = [...new Set(input.userIds.filter((u) => u !== actor.id))];
  await assertActiveUsers(newIds);
  const existing = await db.conversationMember.findMany({
    where: { conversationId: id, userId: { in: newIds } },
    select: { userId: true },
  });
  const existingIds = new Set(existing.map((e) => e.userId));
  const toAdd = newIds.filter((u) => !existingIds.has(u));
  for (const userId of toAdd) {
    await db.conversationMember.create({
      data: { conversationId: id, userId, role: "MEMBER" },
    });
  }
  await writeAuditLog({
    actorId: actor.id,
    action: "conversation.member_add",
    entityType: "conversation",
    entityId: id,
    metadata: { addedUserIds: toAdd },
    ipAddress: ctx.ip,
  });
  return getConversation(actor, id);
}

export async function removeConversationMember(
  actor: Actor,
  id: string,
  targetUserId: string,
  ctx: MutationCtx = {}
) {
  const membership = await requireConversationMember(actor.id, id);
  await getConversationOrThrow(id);
  const target = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: id, userId: targetUserId } },
  });
  if (!target) throw new NotFoundError("Membership not found");

  const selfLeave = actor.id === targetUserId;
  if (!selfLeave) {
    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      throw new ForbiddenError("FORBIDDEN", "Only admins can remove members");
    }
    if (target.role === "OWNER") {
      throw new ForbiddenError("FORBIDDEN", "Cannot remove the conversation owner");
    }
  }

  await db.$transaction(async (tx) => {
    await tx.conversationMember.delete({
      where: { conversationId_userId: { conversationId: id, userId: targetUserId } },
    });
    const remaining = await tx.conversationMember.findMany({
      where: { conversationId: id },
      orderBy: { joinedAt: "asc" },
    });
    if (remaining.length === 0) {
      await tx.conversation.delete({ where: { id } });
      return;
    }
    // Ownership must survive: promote the longest-tenured member.
    if (target.role === "OWNER" && !remaining.some((m) => m.role === "OWNER")) {
      const heir = remaining.find((m) => m.role === "ADMIN") ?? remaining[0];
      await tx.conversationMember.update({
        where: { conversationId_userId: { conversationId: id, userId: heir.userId } },
        data: { role: "OWNER" },
      });
    }
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "conversation.member_remove",
    entityType: "conversation",
    entityId: id,
    metadata: { targetUserId, selfLeave },
    ipAddress: ctx.ip,
  });
  return { ok: true as const };
}

export async function markConversationRead(
  actor: Actor,
  id: string,
  input: ConversationReadInput
) {
  const membership = await requireConversationMember(actor.id, id);
  let readAt = new Date();
  if (input.messageId) {
    const msg = await db.message.findUnique({ where: { id: input.messageId } });
    if (!msg || msg.conversationId !== id) throw new NotFoundError("Message not found");
    readAt = msg.createdAt;
  }
  if (readAt > membership.lastReadAt) {
    await db.conversationMember.update({
      where: { conversationId_userId: { conversationId: id, userId: actor.id } },
      data: { lastReadAt: readAt },
    });
  }
  return { ok: true as const, lastReadAt: readAt.toISOString() };
}

export async function setConversationMuted(
  actor: Actor,
  id: string,
  input: ConversationMuteInput
) {
  await requireConversationMember(actor.id, id);
  await db.conversationMember.update({
    where: { conversationId_userId: { conversationId: id, userId: actor.id } },
    data: { isMuted: input.muted },
  });
  return { ok: true as const, muted: input.muted };
}
