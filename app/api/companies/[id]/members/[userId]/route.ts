import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { removeMember, updateMemberRole } from "@/lib/services/companies";
import { companyMemberRoleSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

export const PATCH = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string; userId: string }>) => {
  const { id, userId } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, companyMemberRoleSchema);
  return ok(await updateMemberRole(user, id, userId, input, { ip: auditIp(req) }));
});

export const DELETE = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string; userId: string }>) => {
  const { id, userId } = await routeParams(ctx);
  const { user } = await requireSession(req);
  return ok(await removeMember(user, id, userId, { ip: auditIp(req) }));
});
