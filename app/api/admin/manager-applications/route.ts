import type { NextRequest } from "next/server";
import { getPaginationParams, handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { listApplications } from "@/lib/services/manager-applications";
import { queryParam } from "@/lib/route";
import type { ManagerApplicationStatus } from "@/lib/prisma-types";

const STATUSES: readonly ManagerApplicationStatus[] = [
  "PENDING",
  "APPROVED",
  "DECLINED",
  "WITHDRAWN",
];

export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const { limit, cursor } = getPaginationParams(req);
  const rawStatus = queryParam(req, "status");
  // An unknown status is ignored rather than rejected — a stale bookmark
  // should still show the list, not an error page.
  const status =
    rawStatus && (STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as ManagerApplicationStatus)
      : undefined;
  return ok(
    await listApplications(user, {
      limit,
      cursor,
      status,
      search: queryParam(req, "search") ?? undefined,
    }),
  );
});
