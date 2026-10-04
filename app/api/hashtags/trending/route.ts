import { NextRequest, NextResponse } from 'next/server';
import { handle, ok } from '@/lib/api';
import { trendingHashtags } from '@/lib/services/search';

export const GET = handle(async (_req: NextRequest): Promise<NextResponse> => {
  return ok({ data: await trendingHashtags() });
});
