import { NextRequest, NextResponse } from 'next/server';
import { handle, ok, parseJson } from '@/lib/api';
import { forgotPassword } from '@/lib/services/auth';
import { forgotPasswordSchema } from '@/lib/validation';

export const POST = handle(
  async (req: NextRequest): Promise<NextResponse> => {
    const input = await parseJson(req, forgotPasswordSchema);
    // Always { ok: true } — no account enumeration (see service).
    await forgotPassword(input.email);
    return ok({ ok: true });
  },
  { csrf: false },
);
