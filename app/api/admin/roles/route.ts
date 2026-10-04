import type { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { rolesOverview } from "@/lib/services/admin";

export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  return ok(await rolesOverview(user));
});
