import type { NextRequest } from "next/server";
import { getPaginationParams, handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { listReports } from "@/lib/services/admin";
import { queryParam } from "@/lib/route";

export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const { limit, cursor } = getPaginationParams(req);
  return ok(
    await listReports(user, {
      limit,
      cursor,
      status: (queryParam(req, "status") as "PENDING" | "IN_REVIEW" | "ACTIONED" | "DISMISSED" | null) ?? undefined,
    })
  );
});
