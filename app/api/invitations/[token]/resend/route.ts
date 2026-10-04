import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { resendInvitation } from "@/lib/services/invitations";
import { routeParams } from "@/lib/route";

export const POST = handle(async (req: NextRequest, ctx?: RouteContext<{ token: string }>) => {
  const { token } = await routeParams(ctx);
  const { user } = await requireSession(req);
  return ok(await resendInvitation(user, token, { ip: auditIp(req) }));
});
