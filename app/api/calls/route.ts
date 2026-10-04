import type { NextRequest } from "next/server";
import { created, handle, parseJson } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { initiateCall } from "@/lib/services/calls";
import { callCreateSchema } from "@/lib/validation";

export const POST = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const input = await parseJson(req, callCreateSchema);
  return created(await initiateCall(user, input));
});
