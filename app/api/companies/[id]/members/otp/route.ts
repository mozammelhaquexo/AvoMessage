import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { requestMemberAccountOtp } from "@/lib/services/companies";
import { accountOtpRequestSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

/**
 * Manager-only: send an OTP to a new member's email address.
 *
 * The sibling route `create-account` creates the user immediately and mails a
 * temp password, which trusts the manager's typing of somebody else's address.
 * This one sends a code instead, and the account appears only when that address
 * confirms it.
 *
 * The body carries no `role`. A manager can only create MEMBERs — the role is a
 * constant inside the service, and `assertRoleAssignableByManager` is what
 * refuses MANAGER on this path (part 2, request 3).
 */
export const POST = handle(
  async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
    const { id } = await routeParams(ctx);
    const { user } = await requireSession(req);
    const input = await parseJson(req, accountOtpRequestSchema);
    return ok(await requestMemberAccountOtp(user, id, input, { ip: auditIp(req) }));
  },
  { rateLimit: "otp" }
);
