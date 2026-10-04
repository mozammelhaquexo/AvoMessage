import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { acceptInvitation, validateInvitationToken } from "@/lib/services/invitations";
import { routeParams } from "@/lib/route";

export const GET = handle(async (req: NextRequest, ctx?: RouteContext) => {
  const { token } = await routeParams(ctx);
  // Session is required for the side effect (throws when signed out); the
  // viewer identity is not needed to describe the invitation.
  await requireSession(req);
  return ok(await validateInvitationToken(token));
});

export const POST = handle(async (req: NextRequest, ctx?: RouteContext) => {
  const { token } = await routeParams(ctx);
  const { user } = await requireSession(req);
  return ok(await acceptInvitation(user, token, { ip: auditIp(req) }));
});
