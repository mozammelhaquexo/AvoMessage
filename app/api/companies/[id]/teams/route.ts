import type { NextRequest } from "next/server";
import { created, handle, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { createTeam } from "@/lib/services/teams";
import { teamCreateSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

export const POST = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, teamCreateSchema);
  return created(await createTeam(user, id, input));
});
