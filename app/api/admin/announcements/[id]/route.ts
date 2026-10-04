import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { deletePlatformAnnouncement } from "@/lib/services/admin";
import { queryParam, routeParams } from "@/lib/route";

export const DELETE = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  return ok(
    await deletePlatformAnnouncement(user, id, queryParam(req, "deleteContent") === "true", {
      ip: auditIp(req),
    })
  );
});
