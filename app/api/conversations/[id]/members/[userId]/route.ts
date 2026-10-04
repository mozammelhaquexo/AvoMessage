import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { removeConversationMember } from "@/lib/services/conversations";
import { routeParams } from "@/lib/route";

export const DELETE = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string; userId: string }>) => {
  const { id, userId } = await routeParams(ctx);
  const { user } = await requireSession(req);
  return ok(await removeConversationMember(user, id, userId, { ip: auditIp(req) }));
});
