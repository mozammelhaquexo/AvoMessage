import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { teamChat } from "@/lib/services/teams";
import { routeParams } from "@/lib/route";

// POST /api/teams/[id]/chat — get-or-create the team's group chat conversation.
export const POST = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  return ok(await teamChat(user, id, { ip: auditIp(req) }));
});
