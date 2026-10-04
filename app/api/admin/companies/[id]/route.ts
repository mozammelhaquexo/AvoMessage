import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { updateCompanyAdmin } from "@/lib/services/admin";
import { adminCompanyUpdateSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

export const PATCH = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, adminCompanyUpdateSchema);
  return ok(await updateCompanyAdmin(user, id, input, { ip: auditIp(req) }));
});
