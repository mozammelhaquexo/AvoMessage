import { NextRequest, NextResponse } from 'next/server';
import { handle, ok, parseJson } from '@/lib/api';
import { getClientIp } from '@/lib/rate-limit';
import { requireSession } from '@/lib/permissions';
import { changePassword } from '@/lib/services/auth';
import { changePasswordSchema } from '@/lib/validation';

export const POST = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user, session } = await requireSession(req);
  const input = await parseJson(req, changePasswordSchema);
  const result = await changePassword(user, input.currentPassword, input.newPassword, {
    ipAddress: getClientIp(req),
    userAgent: req.headers.get('user-agent'),
    currentSessionId: session.id,
  });
  return ok({ ok: true, revokedOtherSessions: result.revokedOthers });
});
