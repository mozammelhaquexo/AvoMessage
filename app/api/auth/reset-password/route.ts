import { NextRequest, NextResponse } from 'next/server';
import { handle, ok, parseJson } from '@/lib/api';
import { getClientIp } from '@/lib/rate-limit';
import { resetPassword } from '@/lib/services/auth';
import { resetPasswordSchema } from '@/lib/validation';

export const POST = handle(
  async (req: NextRequest): Promise<NextResponse> => {
    const input = await parseJson(req, resetPasswordSchema);
    await resetPassword(input.token, input.password, {
      ipAddress: getClientIp(req),
      userAgent: req.headers.get('user-agent'),
    });
    return ok({ ok: true });
  },
  { csrf: false },
);
