import { NextRequest, NextResponse } from 'next/server';
import { handle, ok, parseJson } from '@/lib/api';
import { requireSession } from '@/lib/permissions';
import { getPreferences, updatePreferences } from '@/lib/services/notifications';
import { notificationPrefsSchema } from '@/lib/validation';

export const GET = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user } = await requireSession(req);
  return ok(await getPreferences(user.id));
});

export const PATCH = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user } = await requireSession(req);
  const input = await parseJson(req, notificationPrefsSchema);
  return ok(await updatePreferences(user.id, input));
});
