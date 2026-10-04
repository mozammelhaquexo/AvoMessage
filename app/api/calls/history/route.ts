import type { NextRequest } from "next/server";
import { getPaginationParams, handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { callHistory } from "@/lib/services/calls";

export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const { limit, cursor } = getPaginationParams(req);
  return ok(await callHistory(user, { limit, cursor }));
});
