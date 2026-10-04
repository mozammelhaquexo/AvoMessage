import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { created, handle, parseJson } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { completeManagerAccountOtp } from "@/lib/services/admin";
import { completeMemberAccountOtp } from "@/lib/services/companies";
import { OtpError, peekOtpPurpose } from "@/lib/services/otp";
import { otpVerifySchema } from "@/lib/validation";

/**
 * Complete an authenticated OTP flow — the manager-creates-member and
 * admin-creates-manager paths.
 *
 * One endpoint rather than two because the work is identical up to the point of
 * dispatch: verify the code, re-check authorization, execute the stored
 * payload. The only difference is which role the membership gets, and that is
 * decided by the challenge's purpose — which was fixed server-side when the
 * challenge was created, never by anything in this request.
 *
 * SIGNUP is deliberately NOT handled here. Its caller is anonymous, so this
 * route's CSRF check (which requires a session's double-submit pair) would
 * reject it; the public signup flow lives at /api/auth/signup/verify instead.
 * Refusing the purpose outright also means an anonymous signup challenge can
 * never be redeemed through an authenticated endpoint.
 *
 * CSRF is left ON (the wrapper default) because every caller here is signed in.
 */
export const POST = handle(
  async (req: NextRequest) => {
    const { challengeId, code } = await parseJson(req, otpVerifySchema);
    const { user } = await requireSession(req);

    const purpose = await peekOtpPurpose(challengeId);
    const ctx = { ip: auditIp(req) };

    switch (purpose) {
      case "COMPANY_MEMBER":
        return created(await completeMemberAccountOtp(user, challengeId, code, ctx));
      case "COMPANY_MANAGER":
        return created(await completeManagerAccountOtp(user, challengeId, code, ctx));
      default:
        // Unknown id, an expired-and-purged row, or a SIGNUP challenge sent to
        // the wrong door. One indistinguishable error for all three.
        throw new OtpError("OTP_INVALID", "That code is not valid for this action.");
    }
  },
  { rateLimit: "otp" }
);
