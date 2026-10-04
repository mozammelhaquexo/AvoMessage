import { NextRequest, NextResponse } from 'next/server';
import { handle, NotFoundError, ok, RouteContext } from '@/lib/api';
import { requireSession } from '@/lib/permissions';
import { markNotificationRead } from '@/lib/services/notifications';

export const POST = handle(
  async (req: NextRequest, ctx?: RouteContext<{ id: string }>): Promise<NextResponse> => {
    const { user } = await requireSession(req);
    const id = (await ctx?.params)?.id;
    if (!id) throw new NotFoundError('Notification not found');
    await markNotificationRead(user.id, id);
    return ok({ ok: true });
  },
);
