import { NextRequest, NextResponse } from 'next/server';
import { getPaginationParams, handle, ok } from '@/lib/api';
import { requireSession } from '@/lib/permissions';
import { listBookmarks } from '@/lib/services/posts';

export const GET = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user } = await requireSession(req);
  const { limit, cursor } = getPaginationParams(req);
  return ok(await listBookmarks(user.id, { limit, cursor }));
});
