import { NextRequest, NextResponse } from 'next/server';
import { handle, ok, parseJson } from '@/lib/api';
import { requestSignupOtp } from '@/lib/services/auth';
import { signupSchema } from '@/lib/validation';

/**
 * Step 1 of signup — send the code.
 *
 * This route no longer creates anything. It validates the form, checks that the
 * address and username are free (for a fast, useful error), hashes the password
 * and parks the whole pending account on an OTP challenge. The user row does
 * not exist until `/api/auth/signup/verify` sees a correct code.
 *
 * 202 Accepted, not 201 Created: the request was accepted and processing is
 * pending. Returning 201 here would be a lie the client could act on.
 *
 * `csrf: false` because the caller has no session yet, and the CSRF cookie is
 * only issued alongside one — there is nothing to double-submit. `rateLimit:
 * 'register'` (5/hour/IP) is the right budget for creating accounts, and is
 * deliberately tighter than the `otp` preset.
 */
export const POST = handle(
  async (req: NextRequest): Promise<NextResponse> => {
    const input = await parseJson(req, signupSchema);
    const result = await requestSignupOtp(input);
    return ok(result, 202);
  },
  { csrf: false, rateLimit: 'register' },
);
