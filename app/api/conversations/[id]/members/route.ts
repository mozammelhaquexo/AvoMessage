import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { created, handle, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { addConversationMembers } from "@/lib/services/conversations";
import { conversationMembersAddSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

export const POST = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, conversationMembersAddSchema);
  return created(await addConversationMembers(user, id, input, { ip: auditIp(req) }));
});
