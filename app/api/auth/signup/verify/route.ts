import { NextRequest, NextResponse } from 'next/server';
import { created, handle, parseJson } from '@/lib/api';
import { setAuthCookies } from '@/lib/auth/session';
import { getClientIp } from '@/lib/rate-limit';
import { completeSignupOtp } from '@/lib/services/auth';
import { otpVerifySchema } from '@/lib/validation';

/**
 * Step 2 of signup — a correct code is what creates the account.
 *
 * The body is only `{ challengeId, code }`. The name, username, email and
 * password are read back from the challenge the server stored in step 1, so a
 * caller cannot ask for a code for its own address and then redeem it against
 * somebody else's details.
 *
 * `csrf: false` for the same reason as step 1 — the visitor still has no
 * session, so there is no double-submit pair to compare. `rateLimit: 'otp'`
 * (6/min/IP) bounds guessing from one host, on top of the per-challenge
 * attempt cap that is the primary defence.
 */
export const POST = handle(
  async (req: NextRequest): Promise<NextResponse> => {
    const { challengeId, code } = await parseJson(req, otpVerifySchema);
    const result = await completeSignupOtp(challengeId, code, {
      ipAddress: getClientIp(req),
      userAgent: req.headers.get('user-agent'),
    });
    const res = created({ user: result.user });
    setAuthCookies(res, result.session);
    return res;
  },
  { csrf: false, rateLimit: 'otp' },
);
