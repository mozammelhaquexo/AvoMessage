import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { reviewJoinRequest } from "@/lib/services/companies";
import { joinRequestReviewSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

export const PATCH = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string; requestId: string }>) => {
  const { id, requestId } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, joinRequestReviewSchema);
  return ok(await reviewJoinRequest(user, id, requestId, input, { ip: auditIp(req) }));
});
