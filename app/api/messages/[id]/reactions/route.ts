import type { NextRequest } from "next/server";
import { handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { removeReaction, toggleReaction } from "@/lib/services/messages";
import { reactionToggleSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

export const POST = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, reactionToggleSchema);
  return ok(await toggleReaction(user, id, input));
});

export const DELETE = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, reactionToggleSchema);
  return ok(await removeReaction(user, id, input));
});
