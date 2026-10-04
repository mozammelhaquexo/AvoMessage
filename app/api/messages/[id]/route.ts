import type { NextRequest } from "next/server";
import { handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { deleteMessage, editMessage } from "@/lib/services/messages";
import { messageUpdateSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

export const PATCH = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, messageUpdateSchema);
  return ok(await editMessage(user, id, input));
});

export const DELETE = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  return ok(await deleteMessage(user, id));
});
