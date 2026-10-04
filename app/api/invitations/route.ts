import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { created, handle, ok, parseJson } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { createInvitation, listInvitations } from "@/lib/services/invitations";
import { invitationCreateSchema } from "@/lib/validation";
import { queryParam } from "@/lib/route";

export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  return ok(await listInvitations(user, queryParam(req, "companyId") ?? undefined));
});

export const POST = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const input = await parseJson(req, invitationCreateSchema);
  return created(await createInvitation(user, input, { ip: auditIp(req) }));
});
