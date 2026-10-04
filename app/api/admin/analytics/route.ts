import type { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { analytics } from "@/lib/services/admin";
import { queryParam } from "@/lib/route";

export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const days = Math.min(90, Math.max(1, Number(queryParam(req, "days") ?? "30") || 30));
  return ok(await analytics(user, days));
});
