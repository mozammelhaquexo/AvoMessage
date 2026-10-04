import type { NextRequest } from "next/server";
import { created, getPaginationParams, handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { listMessages, sendMessage } from "@/lib/services/messages";
import { messageCreateSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

export const GET = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const { limit, cursor } = getPaginationParams(req);
  return ok(await listMessages(user, id, { limit, cursor }));
});

export const POST = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, messageCreateSchema);
  const { message, created: isNew } = await sendMessage(user, id, input);
  return isNew ? created({ message }) : ok({ message });
});
