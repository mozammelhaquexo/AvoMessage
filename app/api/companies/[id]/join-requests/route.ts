import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, parseJson, created, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { createJoinRequest, listJoinRequests } from "@/lib/services/companies";
import { joinRequestCreateSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

export const GET = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const status = new URL(req.url).searchParams.get("status");
  return ok(
    await listJoinRequests(
      user,
      id,
      status === "PENDING" || status === "APPROVED" || status === "DECLINED" ? status : undefined
    )
  );
});

export const POST = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, joinRequestCreateSchema);
  return created(await createJoinRequest(user, id, input, { ip: auditIp(req) }));
});
