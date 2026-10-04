import type { NextRequest } from "next/server";
import { getPaginationParams, handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { listCompaniesAdmin } from "@/lib/services/admin";
import { queryParam } from "@/lib/route";

export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const { limit, cursor } = getPaginationParams(req);
  const isActiveParam = queryParam(req, "isActive");
  return ok(
    await listCompaniesAdmin(user, {
      limit,
      cursor,
      search: queryParam(req, "search") ?? undefined,
      isActive: isActiveParam === null ? undefined : isActiveParam === "true",
    })
  );
});
