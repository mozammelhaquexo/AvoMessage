import type { NextRequest } from "next/server";
import { handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { getCall, transitionCall } from "@/lib/services/calls";
import { callTransitionSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

export const GET = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  return ok(await getCall(user, id));
});

export const PATCH = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, callTransitionSchema);
  return ok(await transitionCall(user, id, input));
});
