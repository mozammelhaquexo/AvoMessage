/**
 * lib/services/messages.ts — messages domain (Backend Engineer B).
 *
 * Member-checked reads/writes. Sending requires a verified email (RBAC §2.4).
 * Edit window: 15 minutes, sender only. Deletes are soft (tombstones).
 *
 * Idempotency: ARCHITECTURE.md §3 wants UNIQUE(conversationId, clientId) —
 * the schema has no clientId column yet, so dedupe is an in-memory TTL map
 * (single instance, v1). The map is keyed `${conversationId}:${clientId}`.
 */
import { prisma } from "@/lib/db";

/** Typed DB facade (pre-generation stand-in; real client later). */
const db = prisma as unknown as PrismaClientLike;
import {
  ForbiddenError,
  NotFoundError,
} from "@/lib/api";
import { requireConversationMember } from "@/lib/permissions";
import { decodeCursor, encodeCursor, EmailUnverifiedError } from "@/lib/api";
import { notifyNewMessage } from "@/lib/message-notify";
import type {
  Actor,
  Message,
  MessageFull,
  PrismaClientLike,
} from "@/lib/prisma-types";
import { messageView, reactionViews } from "./serialize";
import type {
  MessageCreateInput,
  MessageUpdateInput,
  ReactionToggleInput,
} from "@/lib/validation";
import type { PageOpts } from "./companies";

export const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

// ─── clientId idempotency (in-memory, v1) ────────────────────────────────────
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const seenClientIds = new Map<string, { messageId: string; expiresAt: number }>();

function idempotencyKey(conversationId: string, clientId: string): string {
  return `${conversationId}:${clientId}`;
}

function checkIdempotent(conversationId: string, clientId?: string): string | null {
  if (!clientId) return null;
  const hit = seenClientIds.get(idempotencyKey(conversationId, clientId));
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    seenClientIds.delete(idempotencyKey(conversationId, clientId));
    return null;
  }
  return hit.messageId;
}

function rememberIdempotent(conversationId: string, clientId: string, messageId: string): void {
  if (seenClientIds.size > 10_000) {
    const now = Date.now();
    for (const [k, v] of seenClientIds) if (v.expiresAt <= now) seenClientIds.delete(k);
  }
  seenClientIds.set(idempotencyKey(conversationId, clientId), {
    messageId,
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
  });
}

async function getMessageOrThrow(id: string): Promise<Message> {
  const msg = await db.message.findUnique({ where: { id } });
  if (!msg || msg.deletedAt) throw new NotFoundError("Message not found");
  return msg;
}

function fullMessageInclude() {
  return {
    sender: true,
    attachments: true,
    reactions: true,
    voice: true,
    // Both quote relations are loaded so a reply survives a reload and a
    // forward can name its source. Shallow `sender` only — a quote is never
    // recursive.
    replyTo: { include: { sender: true } },
    forwardedFrom: { include: { sender: true } },
  };
}

// ─── Queries ────────────────────────────────────────────────────────────────

export async function listMessages(actor: Actor, conversationId: string, opts: PageOpts) {
  await requireConversationMember(actor.id, conversationId);
  let cursorCond: Record<string, unknown> | null = null;
  if (opts.cursor) {
    const { createdAt, id } = decodeCursor(opts.cursor);
    cursorCond = {
      OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
    };
  }
  const messages = await db.message.findMany<MessageFull>({
    where: {
      conversationId,
      // NOTE: no deletedAt filter — messageView() maps soft-deleted rows to
      // tombstones ({ deleted: true }), per ARCHITECTURE.md §8. The chat UI
      // renders these ("This message was deleted").
      ...(cursorCond ? { AND: [cursorCond] } : {}),
    },
    include: fullMessageInclude(),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
  });
  const page = messages.slice(0, opts.limit);
  return {
    data: page.map((m) => messageView(m, actor.id)),
    nextCursor:
      messages.length > opts.limit
        ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id)
        : null,
  };
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export async function sendMessage(
  actor: Actor,
  conversationId: string,
  input: MessageCreateInput
) {
  await requireConversationMember(actor.id, conversationId);
  if (!actor.emailVerifiedAt) throw new EmailUnverifiedError();

  // Idempotent retry: return the already-created message.
  if (input.clientId) {
    const existingId = checkIdempotent(conversationId, input.clientId);
    if (existingId) {
      const existing = await db.message.findUnique<MessageFull>({
        where: { id: existingId },
        include: fullMessageInclude(),
      });
      if (existing && !existing.deletedAt) {
        return { message: messageView(existing, actor.id), created: false as const };
      }
    }
  }

  // The quoted parent must exist AND live in this conversation. Without the
  // second check a reply could quote a message the other readers cannot see,
  // which is a disclosure channel.
  if (input.replyToId) {
    const target = await db.message.findUnique({ where: { id: input.replyToId } });
    if (!target || target.conversationId !== conversationId) {
      throw new NotFoundError("Replied-to message not found in this conversation");
    }
  }

  // A forward legitimately points across conversations, so it is NOT
  // constrained to this one — but the actor must be able to read the source,
  // otherwise forwarding becomes an exfiltration path.
  if (input.forwardedFromId) {
    const source = await db.message.findUnique({ where: { id: input.forwardedFromId } });
    if (!source) throw new NotFoundError("Forwarded message not found");
    await requireConversationMember(actor.id, source.conversationId);
  }

  // attachmentIds: copy existing attachments onto the new message (forwarding).
  let copiedAttachments: Array<{
    kind: "IMAGE" | "VIDEO" | "FILE" | "VOICE";
    url: string;
    name: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    width: number | null;
    height: number | null;
  }> = [];
  if (input.attachmentIds?.length) {
    const sources = await db.attachment.findMany({
      where: { id: { in: input.attachmentIds } },
    });
    if (sources.length !== input.attachmentIds.length) {
      throw new NotFoundError("One or more attachments not found");
    }
    copiedAttachments = sources.map((a) => ({
      kind: a.kind,
      url: a.url,
      name: a.name,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      width: a.width,
      height: a.height,
    }));
  }

  const inlineAttachments = (input.attachments ?? []).map((a) => ({
    kind: a.kind,
    url: a.url,
    name: a.name ?? null,
    mimeType: a.mimeType ?? null,
    sizeBytes: a.sizeBytes ?? null,
    width: a.width ?? null,
    height: a.height ?? null,
  }));

  const message = await db.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId,
        senderId: actor.id,
        body: input.body?.trim() || null,
        type: input.voice ? "VOICE" : input.type,
        replyToId: input.replyToId ?? null,
        forwardedFromId: input.forwardedFromId ?? null,
      },
    });
    for (const a of [...inlineAttachments, ...copiedAttachments]) {
      await tx.attachment.create({ data: { ...a, messageId: created.id } });
    }
    if (input.voice) {
      await tx.voiceMessage.create({
        data: {
          messageId: created.id,
          senderId: actor.id,
          url: input.voice.url,
          durationSeconds: input.voice.durationSeconds,
          waveform: (input.voice.waveform ?? null) as unknown as object,
          mimeType: input.voice.mimeType ?? null,
          sizeBytes: input.voice.sizeBytes ?? null,
        },
      });
    }
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: created.createdAt },
    });
    return tx.message.findUnique<MessageFull>({ where: { id: created.id }, include: fullMessageInclude() });
  });

  if (input.clientId && message) {
    rememberIdempotent(conversationId, input.clientId, message.id);
  }

  /*
   * Tell the other members.
   *
   * THIS IS THE FIX FOR "kono user message korle o notification ashe na".
   * Notification creation used to live only in `fanOutConversationUpdate`
   * (lib/realtime/server.ts), and Vercel never runs `server.ts` — it runs Next
   * route handlers. So on the deployment no MESSAGE notification row was ever
   * written and no push could ever be sent, regardless of what the client did.
   * Doing it here means it happens on every host and every transport.
   *
   * Awaited rather than fire-and-forget on purpose: a serverless function is
   * frozen once the response is flushed, so a detached promise would be killed
   * mid-flight and the notification would be lost intermittently. The cost is
   * bounded — notification rows are a few indexed inserts, and every push
   * round trip is capped by SEND_TIMEOUT_MS in lib/message-notify.ts.
   *
   * Skipped on an idempotent retry: `message` is only non-null for a real
   * insert, so a client re-sending the same `clientId` cannot notify twice.
   */
  if (message) {
    await notifyNewMessage(db, {
      conversationId,
      senderId: actor.id,
      senderName: message.sender?.name ?? actor.name,
      senderAvatarUrl: message.sender?.avatarUrl ?? null,
      messageId: message.id,
      body: message.body,
      hasVoice: Boolean(input.voice) || message.attachments.some((a) => a.kind === "VOICE"),
      attachmentKinds: message.attachments.map((a) => a.kind),
    }).catch((err: unknown) => {
      // A notification is a courtesy on top of a message that is already
      // committed — never turn it into a failed send.
      console.error("[messages] notification fan-out failed", err);
    });
  }

  return {
    message: messageView(message!, actor.id),
    created: true as const,
  };
}

/**
 * Forward a message into another conversation.
 *
 * Copies the text, attachments and voice note onto a NEW message in the target
 * conversation, and records `forwardedFromId` so the bubble can say where it
 * came from. The original is untouched — a forward is not a move.
 */
export async function forwardMessage(
  actor: Actor,
  sourceMessageId: string,
  targetConversationId: string,
  note?: string,
) {
  const source = await db.message.findUnique<MessageFull>({
    where: { id: sourceMessageId },
    include: fullMessageInclude(),
  });
  if (!source || source.deletedAt) throw new NotFoundError("Message not found");
  // Read access to the source, write access to the target.
  await requireConversationMember(actor.id, source.conversationId);
  await requireConversationMember(actor.id, targetConversationId);
  if (!actor.emailVerifiedAt) throw new EmailUnverifiedError();

  return sendMessage(actor, targetConversationId, {
    body: note?.trim() || source.body || undefined,
    // SYSTEM is not a sendable type — a forwarded system row degrades to TEXT.
    type: source.type === "SYSTEM" ? "TEXT" : source.type,
    // Re-uploading the bytes would be wasteful and would break the origin
    // URL, so the existing attachment rows are copied by id. Voice notes are
    // stored as VOICE-kind attachments, so this covers them too.
    attachmentIds: source.attachments.map((a) => a.id),
    forwardedFromId: source.id,
  });
}

export async function editMessage(actor: Actor, id: string, input: MessageUpdateInput) {
  const msg = await getMessageOrThrow(id);
  if (msg.senderId !== actor.id) {
    throw new ForbiddenError("FORBIDDEN", "Only the sender can edit this message");
  }
  if (Date.now() - msg.createdAt.getTime() > MESSAGE_EDIT_WINDOW_MS) {
    throw new ForbiddenError("MESSAGE_EDIT_EXPIRED", "Messages can only be edited within 15 minutes");
  }
  const updated = await db.message.update<MessageFull>({
    where: { id },
    data: { body: input.body.trim(), editedAt: new Date() },
    include: fullMessageInclude(),
  });
  return { message: messageView(updated, actor.id) };
}

export async function deleteMessage(actor: Actor, id: string) {
  const msg = await getMessageOrThrow(id);
  const membership = await requireConversationMember(actor.id, msg.conversationId);
  const isSender = msg.senderId === actor.id;
  const isMod = membership.role === "OWNER" || membership.role === "ADMIN";
  if (!isSender && !isMod) {
    throw new ForbiddenError("FORBIDDEN", "Only the sender or conversation admins can delete this message");
  }
  await db.message.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true as const };
}

async function currentReactions(messageId: string, viewerId: string) {
  const reactions = await db.messageReaction.findMany({ where: { messageId } });
  return { reactions: reactionViews(reactions, viewerId) };
}

export async function toggleReaction(actor: Actor, id: string, input: ReactionToggleInput) {
  const msg = await getMessageOrThrow(id);
  await requireConversationMember(actor.id, msg.conversationId);
  const existing = await db.messageReaction.findUnique({
    where: { messageId_userId_emoji: { messageId: id, userId: actor.id, emoji: input.emoji } },
  });
  if (existing) {
    await db.messageReaction.delete({
      where: { messageId_userId_emoji: { messageId: id, userId: actor.id, emoji: input.emoji } },
    });
  } else {
    await db.messageReaction.create({
      data: { messageId: id, userId: actor.id, emoji: input.emoji },
    });
  }
  return currentReactions(id, actor.id);
}

export async function removeReaction(actor: Actor, id: string, input: ReactionToggleInput) {
  const msg = await getMessageOrThrow(id);
  await requireConversationMember(actor.id, msg.conversationId);
  await db.messageReaction
    .delete({
      where: { messageId_userId_emoji: { messageId: id, userId: actor.id, emoji: input.emoji } },
    })
    .catch(() => null);
  return currentReactions(id, actor.id);
}
