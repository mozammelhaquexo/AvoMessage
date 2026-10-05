import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { getManagerCompanyDetail, deleteCompanyAdmin, updateCompanyAdmin } from "@/lib/services/admin";
import { adminCompanyUpdateSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

/**
 * Full-page detail for one company in the merged "Managers" section
 * (request 5): the manager count, every manager, and how many users sit under
 * each of them.
 */
export const GET = handle(async (req: NextRequest, ctx?: RouteContext<{ companyId: string }>) => {
  const { companyId } = await routeParams(ctx);
  const { user } = await requireSession(req);
  return ok(await getManagerCompanyDetail(user, companyId));
});

/** Deactivate / reactivate, folded in from the old Companies section. */
export const PATCH = handle(
  async (req: NextRequest, ctx?: RouteContext<{ companyId: string }>) => {
    const { companyId } = await routeParams(ctx);
    const { user } = await requireSession(req);
    const input = await parseJson(req, adminCompanyUpdateSchema);
    return ok(await updateCompanyAdmin(user, companyId, input, { ip: auditIp(req) }));
  }
);

/**
 * Permanent removal, folded in with the rest of the old Companies section.
 *
 * `204 No Content` on success: the resource is gone, so there is no
 * representation to return. The service refuses while the company is still
 * active — see `deleteCompanyAdmin` for why the two steps are separate.
 */
export const DELETE = handle(
  async (req: NextRequest, ctx?: RouteContext<{ companyId: string }>) => {
    const { companyId } = await routeParams(ctx);
    const { user } = await requireSession(req);
    await deleteCompanyAdmin(user, companyId, { ip: auditIp(req) });
    return new NextResponse(null, { status: 204 });
  }
);
