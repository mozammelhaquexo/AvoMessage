import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { created, getPaginationParams, handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { addMember, listMembers } from "@/lib/services/companies";
import { companyMemberAddSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

export const GET = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const { limit, cursor } = getPaginationParams(req);
  return ok(await listMembers(user, id, { limit, cursor }));
});

export const POST = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, companyMemberAddSchema);
  return created(await addMember(user, id, input, { ip: auditIp(req) }));
});
