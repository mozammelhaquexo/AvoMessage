import type { NextRequest } from "next/server";
import { handle, ok, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { getCompanyAnalytics } from "@/lib/services/companies";
import { routeParams } from "@/lib/route";

export const GET = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  return ok(await getCompanyAnalytics(user, id));
});
