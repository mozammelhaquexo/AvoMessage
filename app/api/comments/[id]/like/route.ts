import { NextRequest, NextResponse } from 'next/server';
import { handle, NotFoundError, ok, RouteContext } from '@/lib/api';
import { requireSession, requireVerified } from '@/lib/permissions';
import { likeComment, unlikeComment } from '@/lib/services/comments';

async function getId(ctx?: RouteContext<{ id: string }>): Promise<string> {
  const id = (await ctx?.params)?.id;
  if (!id) throw new NotFoundError('Comment not found');
  return id;
}

export const POST = handle(
  async (req: NextRequest, ctx?: RouteContext<{ id: string }>): Promise<NextResponse> => {
    const { user } = await requireSession(req);
    requireVerified(user);
    return ok(await likeComment(await getId(ctx), user.id));
  },
);

export const DELETE = handle(
  async (req: NextRequest, ctx?: RouteContext<{ id: string }>): Promise<NextResponse> => {
    const { user } = await requireSession(req);
    return ok(await unlikeComment(await getId(ctx), user.id));
  },
);
