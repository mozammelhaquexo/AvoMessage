import { NextRequest, NextResponse } from 'next/server';
import { handle, ok, parseJson } from '@/lib/api';
import { requireSession } from '@/lib/permissions';
import { markNotificationsRead } from '@/lib/services/notifications';
import { markNotificationsReadSchema } from '@/lib/validation';

/** { ids? } — empty/missing body = mark ALL as read. */
export const POST = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user } = await requireSession(req);
  let ids: string[] | undefined;
  try {
    const input = await parseJson(req, markNotificationsReadSchema);
    ids = input.ids;
  } catch {
    ids = undefined; // empty body = mark all
  }
  return ok(await markNotificationsRead(user.id, ids));
});
