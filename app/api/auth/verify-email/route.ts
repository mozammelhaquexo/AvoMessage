import { NextRequest, NextResponse } from 'next/server';
import { handle, ok, parseJson } from '@/lib/api';
import { auditIp } from '@/lib/audit';
import { verifyEmail } from '@/lib/services/auth';
import { verifyEmailSchema } from '@/lib/validation';

export const POST = handle(
  async (req: NextRequest): Promise<NextResponse> => {
    const input = await parseJson(req, verifyEmailSchema);
    const user = await verifyEmail(input.token, auditIp(req));
    return ok({ ok: true, user });
  },
  { csrf: false },
);
