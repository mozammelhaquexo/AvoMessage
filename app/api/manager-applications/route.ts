import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { created, handle, ok, parseJson } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { getMyApplication, submitApplication } from "@/lib/services/manager-applications";
import { managerApplicationSchema } from "@/lib/validation";

/**
 * The applicant's own manager application.
 *
 * `GET` returns the most recent one (any status) so the Settings tab can show
 * a decision note; `POST` submits a new one. Both are scoped to the session
 * user — there is no id in the path to tamper with.
 */
export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  return ok(await getMyApplication(user));
});

export const POST = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const input = await parseJson(req, managerApplicationSchema);
  return created(await submitApplication(user, input, { ip: auditIp(req) }));
});
