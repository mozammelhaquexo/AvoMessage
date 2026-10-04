import { NextRequest, NextResponse } from 'next/server';
import { created, getPaginationParams, handle, NotFoundError, ok, parseJson, RouteContext } from '@/lib/api';
import { requireSession, requireVerified } from '@/lib/permissions';
import { createComment, listComments } from '@/lib/services/comments';
import { commentCreateSchema } from '@/lib/validation';

async function getId(ctx?: RouteContext<{ id: string }>): Promise<string> {
  const id = (await ctx?.params)?.id;
  if (!id) throw new NotFoundError('Post not found');
  return id;
}

async function getViewerId(req: NextRequest): Promise<string | null> {
  try {
    return (await requireSession(req)).user.id;
  } catch {
    return null;
  }
}

export const GET = handle(
  async (req: NextRequest, ctx?: RouteContext<{ id: string }>): Promise<NextResponse> => {
    const { limit, cursor } = getPaginationParams(req);
    return ok(await listComments(await getId(ctx), await getViewerId(req), { limit, cursor }));
  },
);

export const POST = handle(
  async (req: NextRequest, ctx?: RouteContext<{ id: string }>): Promise<NextResponse> => {
    const { user } = await requireSession(req);
    requireVerified(user);
    const input = await parseJson(req, commentCreateSchema);
    return created(await createComment(await getId(ctx), user.id, input));
  },
);
