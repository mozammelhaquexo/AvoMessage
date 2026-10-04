import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, parseJson } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { moderationAction } from "@/lib/services/admin";
import { moderationActionSchema } from "@/lib/validation";

export const POST = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const input = await parseJson(req, moderationActionSchema);
  return ok(await moderationAction(user, input, { ip: auditIp(req) }));
});
