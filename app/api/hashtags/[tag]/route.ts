import { NextRequest, NextResponse } from 'next/server';
import { getPaginationParams, handle, NotFoundError, ok, RouteContext } from '@/lib/api';
import { requireSession } from '@/lib/permissions';
import { hashtagTimeline } from '@/lib/services/search';

export const GET = handle(
  async (req: NextRequest, ctx?: RouteContext<{ tag: string }>): Promise<NextResponse> => {
    const tag = (await ctx?.params)?.tag;
    if (!tag) throw new NotFoundError('Hashtag not found');
    let viewerId: string | null = null;
    try {
      viewerId = (await requireSession(req)).user.id;
    } catch {
      viewerId = null;
    }
    const { limit, cursor } = getPaginationParams(req);
    return ok(await hashtagTimeline(decodeURIComponent(tag), viewerId, { limit, cursor }));
  },
);
