import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { removeTeamMember, updateTeamMember } from "@/lib/services/teams";
import { teamMemberRoleSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

export const PATCH = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string; userId: string }>) => {
  const { id, userId } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, teamMemberRoleSchema);
  return ok(await updateTeamMember(user, id, userId, input, { ip: auditIp(req) }));
});

export const DELETE = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string; userId: string }>) => {
  const { id, userId } = await routeParams(ctx);
  const { user } = await requireSession(req);
  return ok(await removeTeamMember(user, id, userId, { ip: auditIp(req) }));
});
