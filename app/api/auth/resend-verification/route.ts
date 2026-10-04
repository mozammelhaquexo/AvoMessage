import { NextRequest, NextResponse } from 'next/server';
import { handle, ok } from '@/lib/api';
import { requireSession } from '@/lib/permissions';
import { resendVerification } from '@/lib/services/auth';

export const POST = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user } = await requireSession(req);
  await resendVerification(user);
  return ok({ ok: true });
});
