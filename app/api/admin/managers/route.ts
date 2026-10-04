import type { NextRequest } from "next/server";
import { getPaginationParams, handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { listManagerCompanies } from "@/lib/services/admin";
import { queryParam } from "@/lib/route";

/**
 * The merged "Managers" admin section (request 5): companies with their manager
 * counts, not a flat list of people. Clicking a company opens
 * `/admin/managers/[companyId]`.
 */
export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const { limit, cursor } = getPaginationParams(req);
  const isActiveParam = queryParam(req, "isActive");
  return ok(
    await listManagerCompanies(user, {
      limit,
      cursor,
      search: queryParam(req, "search") ?? undefined,
      isActive: isActiveParam === null ? undefined : isActiveParam === "true",
    })
  );
});
