import type { NextRequest } from "next/server";
import { getPaginationParams, handle, ok, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { getActivity } from "@/lib/services/companies";
import { routeParams } from "@/lib/route";

export const GET = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const { limit, cursor } = getPaginationParams(req);
  return ok(await getActivity(user, id, { limit, cursor }));
});
