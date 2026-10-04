import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { getManagerCompanyDetail, updateCompanyAdmin } from "@/lib/services/admin";
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
