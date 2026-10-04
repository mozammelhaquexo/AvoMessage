import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { requestManagerAccountOtp } from "@/lib/services/admin";
import { accountOtpRequestSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

/**
 * Admin-only: send an OTP to a new manager's email address.
 *
 * This is the ONE door to the MANAGER company role (part 2, request 3), and the
 * account is not created here — only the challenge is. A correct code at
 * `/api/otp/verify` is what creates the user and the MANAGER membership.
 *
 * The body carries no `role`. The role is a constant inside the service, so a
 * crafted request cannot ask for anything else, and this endpoint cannot be used
 * to create a plain member or an owner.
 */
export const POST = handle(
  async (req: NextRequest, ctx?: RouteContext<{ companyId: string }>) => {
    const { companyId } = await routeParams(ctx);
    const { user } = await requireSession(req);
    const input = await parseJson(req, accountOtpRequestSchema);
    return ok(await requestManagerAccountOtp(user, companyId, input, { ip: auditIp(req) }));
  },
  { rateLimit: "otp" }
);
