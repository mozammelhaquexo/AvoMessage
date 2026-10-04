import type { NextRequest } from "next/server";
import { getPaginationParams, handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { queryAuditLogs } from "@/lib/services/admin";
import { queryParam } from "@/lib/route";

export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const { limit, cursor } = getPaginationParams(req);
  return ok(
    await queryAuditLogs(user, {
      limit,
      cursor,
      actorId: queryParam(req, "actorId") ?? undefined,
      action: queryParam(req, "action") ?? undefined,
      entityType: queryParam(req, "entityType") ?? undefined,
      entityId: queryParam(req, "entityId") ?? undefined,
      from: queryParam(req, "from") ?? undefined,
      to: queryParam(req, "to") ?? undefined,
    })
  );
});
