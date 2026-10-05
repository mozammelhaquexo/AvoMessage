import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { deleteCompanyAdmin, updateCompanyAdmin } from "@/lib/services/admin";
import { adminCompanyUpdateSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

export const PATCH = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, adminCompanyUpdateSchema);
  return ok(await updateCompanyAdmin(user, id, input, { ip: auditIp(req) }));
});

/**
 * The same removal as `DELETE /api/admin/managers/:companyId`, kept here so the
 * two admin surfaces that address a company by id cannot disagree about what
 * that id supports. `204` — the resource is gone, there is nothing to return.
 */
export const DELETE = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  await deleteCompanyAdmin(user, id, { ip: auditIp(req) });
  return new NextResponse(null, { status: 204 });
});
