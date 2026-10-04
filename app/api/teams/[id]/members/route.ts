import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { created, getPaginationParams, handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { addTeamMember, listTeamMembers } from "@/lib/services/teams";
import { teamMemberAddSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

export const GET = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const { limit, cursor } = getPaginationParams(req);
  return ok(await listTeamMembers(user, id, { limit, cursor }));
});

export const POST = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, teamMemberAddSchema);
  return created(await addTeamMember(user, id, input, { ip: auditIp(req) }));
});
