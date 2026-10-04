import { NextRequest, NextResponse } from 'next/server';
import { handle, ok, parseJson } from '@/lib/api';
import { setAuthCookies } from '@/lib/auth/session';
import { getClientIp } from '@/lib/rate-limit';
import { login } from '@/lib/services/auth';
import { loginSchema } from '@/lib/validation';

export const POST = handle(
  async (req: NextRequest): Promise<NextResponse> => {
    const input = await parseJson(req, loginSchema);
    const result = await login(input, {
      ipAddress: getClientIp(req),
      userAgent: req.headers.get('user-agent'),
    });
    // Unverified users receive a session (limited token): requireVerified()
    // blocks their writes with 403 EMAIL_UNVERIFIED until they verify.
    const res = ok({ user: result.user, emailVerified: result.emailVerified });
    setAuthCookies(res, result.session);
    return res;
  },
  { csrf: false },
);
