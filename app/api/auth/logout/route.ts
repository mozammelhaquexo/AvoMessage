import { NextRequest, NextResponse } from 'next/server';
import { handle, ok } from '@/lib/api';
import { clearAuthCookies, destroySessionByCookieValue, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { requireSession } from '@/lib/permissions';

export const POST = handle(async (req: NextRequest): Promise<NextResponse> => {
  await requireSession(req); // must be logged in to log out
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookieValue) await destroySessionByCookieValue(cookieValue);
  const res = ok({ ok: true });
  clearAuthCookies(res);
  return res;
});
