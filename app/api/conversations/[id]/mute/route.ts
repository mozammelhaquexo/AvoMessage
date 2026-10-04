import type { NextRequest } from "next/server";
import { handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { setConversationMuted } from "@/lib/services/conversations";
import { conversationMuteSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

export const POST = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, conversationMuteSchema);
  return ok(await setConversationMuted(user, id, input));
});
