import type { NextRequest } from "next/server";
import { getPaginationParams, handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { listUsers } from "@/lib/services/admin";
import { queryParam } from "@/lib/route";

export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const { limit, cursor } = getPaginationParams(req);
  const isActiveParam = queryParam(req, "isActive");
  return ok(
    await listUsers(user, {
      limit,
      cursor,
      search: queryParam(req, "search") ?? undefined,
      platformRole: (queryParam(req, "platformRole") as "USER" | "ADMIN" | "SUPER_ADMIN" | null) ?? undefined,
      isActive: isActiveParam === null ? undefined : isActiveParam === "true",
    })
  );
});
