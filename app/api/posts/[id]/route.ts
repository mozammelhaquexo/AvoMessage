import { NextRequest, NextResponse } from 'next/server';
import { handle, NotFoundError, ok, parseJson, RouteContext } from '@/lib/api';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/permissions';
import { deletePost, getPostById, updatePost } from '@/lib/services/posts';
import { postUpdateSchema } from '@/lib/validation';

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
    return ok(await getPostById(await getId(ctx), await getViewerId(req)));
  },
);

export const PATCH = handle(
  async (req: NextRequest, ctx?: RouteContext<{ id: string }>): Promise<NextResponse> => {
    const { user } = await requireSession(req);
    const input = await parseJson(req, postUpdateSchema);
    return ok(await updatePost(await getId(ctx), user.id, input));
  },
);

/**
 * DELETE: the author, a company MANAGER+ (for COMPANY posts in their company),
 * or a platform ADMIN+. Non-authors go through the moderator path — the
 * service re-asserts the scope on the loaded row and throws 403 otherwise.
 */
export const DELETE = handle(
  async (req: NextRequest, ctx?: RouteContext<{ id: string }>): Promise<NextResponse> => {
    const { user } = await requireSession(req);
    const id = await getId(ctx);
    const post = await prisma.post.findUnique({ where: { id }, select: { authorId: true } });
    if (!post) throw new NotFoundError('Post not found');
    if (post.authorId === user.id) {
      await deletePost(id, user.id);
    } else {
      await deletePost(id, user.id, { moderatorId: user.id });
    }
    return ok({ ok: true });
  },
);
