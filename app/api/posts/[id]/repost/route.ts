import { NextRequest, NextResponse } from 'next/server';
import { created, handle, NotFoundError, RouteContext } from '@/lib/api';
import { requireSession, requireVerified } from '@/lib/permissions';
import { repost } from '@/lib/services/posts';

export const POST = handle(
  async (req: NextRequest, ctx?: RouteContext<{ id: string }>): Promise<NextResponse> => {
    const { user } = await requireSession(req);
    requireVerified(user);
    const id = (await ctx?.params)?.id;
    if (!id) throw new NotFoundError('Post not found');
    return created(await repost(id, user.id));
  },
);
