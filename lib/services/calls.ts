/**
 * lib/services/calls.ts — calls domain (Backend Engineer B).
 *
 * WebRTC signaling itself rides Socket.io (lib/realtime); this service owns
 * the persisted call record + state machine. Strict privacy: call metadata is
 * visible to participants only (ARCHITECTURE.md §5, RBAC §2.5).
 *
 * State machine: INITIATED → RINGING → ONGOING → ENDED
 *                                  ↘ DECLINED / MISSED / FAILED
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
import { EmailUnverifiedError, decodeCursor, encodeCursor } from "@/lib/api";
import type {
  Actor,
  CallFull,
  CallParticipantWithCall,
  CallStatus,
  Conversation,
  ConversationMember,
  PrismaClientLike,
} from "@/lib/prisma-types";
import { callView } from "./serialize";
import type { CallCreateInput, CallTransitionInput } from "@/lib/validation";
import type { PageOpts } from "./companies";

interface MutationCtx {
  ip?: string | null;
}

async function getCallOrThrow(id: string) {
  const call = await db.call.findUnique<CallFull>({
    where: { id },
    include: { initiator: true, participants: { include: { user: true } }, conversation: true },
  });
  if (!call) throw new NotFoundError("Call not found");
  return call;
}

/** Participant check — the privacy gate for all call reads/writes. */
async function requireParticipant(actorId: string, call: { id: string; participants: { userId: string }[] }) {
  const isParticipant = call.participants.some((p) => p.userId === actorId);
  if (!isParticipant) {
    throw new ForbiddenError("FORBIDDEN", "Only call participants can access this call");
  }
}

export async function initiateCall(actor: Actor, input: CallCreateInput, _ctx: MutationCtx = {}) {
  if (!actor.emailVerifiedAt) throw new EmailUnverifiedError();

  let participantIds: string[];
  let conversationId: string | null = null;

  if (input.conversationId) {
    const membership = await requireConversationMember(actor.id, input.conversationId);
    void membership;
    const convo = await db.conversation.findUnique<Conversation & { members: ConversationMember[] }>({
      where: { id: input.conversationId },
      include: { members: true },
    });
    if (!convo) throw new NotFoundError("Conversation not found");
    conversationId = convo.id;
    participantIds = convo.members.map((m) => m.userId);
  } else {
    const others = [...new Set(input.userIds.filter((id) => id !== actor.id))];
    if (others.length === 0) {
      throw new ConflictError("NO_CALLEES", "Specify userIds or a conversationId");
    }
    if (others.length > 5) {
      throw new ConflictError("TOO_MANY", "Group calls are capped at 6 participants in v1");
    }
    const users = await db.user.findMany({
      where: { id: { in: others } },
      select: { id: true, isActive: true, deletedAt: true },
    });
    const ok = new Set(users.filter((u) => u.isActive && !u.deletedAt).map((u) => u.id));
    for (const id of others) {
      if (!ok.has(id)) throw new NotFoundError("One or more users not found");
      if (await isBlockedEitherWay(actor.id, id)) {
        throw new ForbiddenError("BLOCKED", "You cannot call this user");
      }
    }
    participantIds = [actor.id, ...others];
  }

  const call = await db.$transaction(async (tx) => {
    const created = await tx.call.create({
      data: {
        conversationId,
        initiatorId: actor.id,
        type: input.type,
        status: "RINGING",
      },
    });
    for (const userId of participantIds) {
      await tx.callParticipant.create({
        data: { callId: created.id, userId },
      });
    }
    return created;
  });

  // NOTE: the realtime layer emits `call:incoming` to each callee's
  // `user:{id}` room (ARCHITECTURE.md §7). Socket emission happens in
  // lib/realtime via the call record returned here.

  const full = await getCallOrThrow(call.id);
  return { call: callView(full) };
}

export async function getCall(actor: Actor, id: string) {
  const call = await getCallOrThrow(id);
  await requireParticipant(actor.id, call);
  return { call: callView(call) };
}

const TERMINAL: CallStatus[] = ["ENDED", "MISSED", "DECLINED", "FAILED"];

export async function transitionCall(actor: Actor, id: string, input: CallTransitionInput) {
  const call = await getCallOrThrow(id);
  await requireParticipant(actor.id, call);

  if (TERMINAL.includes(call.status)) {
    throw new ConflictError("CALL_ENDED", `Call is already ${call.status.toLowerCase()}`);
  }

  const now = new Date();
  if (input.action === "accept") {
    if (call.status !== "RINGING" && call.status !== "INITIATED") {
      throw new ConflictError("INVALID_TRANSITION", "Call cannot be accepted in its current state");
    }
    await db.call.update({ where: { id }, data: { status: "ONGOING" } });
  } else if (input.action === "decline") {
    // A decline ends a 1:1 call; in group calls the decliner just leaves.
    const othersActive = call.participants.filter(
      (p) => p.userId !== actor.id && !p.leftAt
    );
    await db.$transaction(async (tx) => {
      await tx.callParticipant.update({
        where: { callId_userId: { callId: id, userId: actor.id } },
        data: { leftAt: now },
      });
      if (call.participants.length <= 2 || othersActive.length === 0) {
        await tx.call.update({ where: { id }, data: { status: "DECLINED", endedAt: now } });
      }
    });
  } else {
    // end
    await db.$transaction(async (tx) => {
      await tx.call.update({ where: { id }, data: { status: "ENDED", endedAt: now } });
      await tx.callParticipant.updateMany({
        where: { callId: id, leftAt: null },
        data: { leftAt: now },
      });
    });
  }

  const updated = await getCallOrThrow(id);
  return { call: callView(updated) };
}

/**
 * My call history — strict privacy: only calls the actor participated in.
 * Ordered newest first, cursor-paged on startedAt.
 */
export async function callHistory(actor: Actor, opts: PageOpts) {
  let callFilter: Record<string, unknown> | undefined;
  if (opts.cursor) {
    const { createdAt, id } = decodeCursor(opts.cursor);
    callFilter = {
      OR: [{ startedAt: { lt: createdAt } }, { startedAt: createdAt, id: { lt: id } }],
    };
  }
  const participations = await db.callParticipant.findMany<CallParticipantWithCall>({
    where: { userId: actor.id, ...(callFilter ? { call: callFilter } : {}) },
    include: {
      call: {
        include: { initiator: true, participants: { include: { user: true } } },
      },
    },
    orderBy: [{ call: { startedAt: "desc" } }, { callId: "desc" }],
    take: opts.limit + 1,
  });
  const calls = participations.map((p) => p.call).filter(Boolean);
  const page = calls.slice(0, opts.limit);
  return {
    data: page.map(callView),
    nextCursor:
      calls.length > opts.limit
        ? encodeCursor(new Date(page[page.length - 1].startedAt), page[page.length - 1].id)
        : null,
  };
}
