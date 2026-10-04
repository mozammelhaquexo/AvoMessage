import { NextRequest, NextResponse } from 'next/server';
import { created, getPaginationParams, handle, ok, parseJson } from '@/lib/api';
import { requireSession, requireVerified } from '@/lib/permissions';
import { createPost, getWorldFeed } from '@/lib/services/posts';
import { postCreateSchema } from '@/lib/validation';

/**
 * World feed: PUBLIC posts + FOLLOWERS posts from followed users.
 * COMPANY/PRIVATE posts can NEVER appear here — enforced in the Prisma
 * where-clause (see posts.ts worldFeedWhere()).
 */
export const GET = handle(async (req: NextRequest): Promise<NextResponse> => {
  let viewerId: string | null = null;
  try {
    viewerId = (await requireSession(req)).user.id;
  } catch {
    viewerId = null;
  }
  const { limit, cursor } = getPaginationParams(req);
  return ok(await getWorldFeed(viewerId, { limit, cursor }));
});

export const POST = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user } = await requireSession(req);
  requireVerified(user);
  const input = await parseJson(req, postCreateSchema);
  return created(await createPost(user.id, input));
});
