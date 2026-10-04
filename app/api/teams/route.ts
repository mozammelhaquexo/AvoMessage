import type { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { listTeams } from "@/lib/services/teams";
import { queryParam } from "@/lib/route";

// GET /api/teams — my teams (optionally filtered to one company via ?companyId=)
export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  return ok(await listTeams(user, queryParam(req, "companyId") ?? undefined));
});
