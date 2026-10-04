import type { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { dashboard } from "@/lib/services/admin";

export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  return ok(await dashboard(user));
});
