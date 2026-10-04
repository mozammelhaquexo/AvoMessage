import type { NextRequest } from "next/server";
import { created, getPaginationParams, handle, ok, parseJson } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { createConversation, listConversations } from "@/lib/services/conversations";
import { conversationCreateSchema } from "@/lib/validation";

export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const { limit, cursor } = getPaginationParams(req);
  return ok(await listConversations(user, { limit, cursor }));
});

export const POST = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const input = await parseJson(req, conversationCreateSchema);
  const { conversation, created: isNew } = await createConversation(user, input);
  // DM dedupe: an existing pair returns the existing conversation (200),
  // mirroring POST /api/conversations/:id/messages idempotency.
  return isNew ? created({ conversation, created: true }) : ok({ conversation, created: false });
});
