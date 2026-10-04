import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { deleteConversation, getConversation, updateConversation } from "@/lib/services/conversations";
import { conversationUpdateSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

export const GET = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  return ok(await getConversation(user, id));
});

export const PATCH = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, conversationUpdateSchema);
  return ok(await updateConversation(user, id, input, { ip: auditIp(req) }));
});

export const DELETE = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  return ok(await deleteConversation(user, id, { ip: auditIp(req) }));
});
