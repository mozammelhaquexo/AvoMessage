import { NextRequest, NextResponse } from 'next/server';
import { handle, NotFoundError, ok, parseJson, RouteContext } from '@/lib/api';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/permissions';
import { deleteComment, updateComment } from '@/lib/services/comments';
import { commentUpdateSchema } from '@/lib/validation';

async function getId(ctx?: RouteContext<{ id: string }>): Promise<string> {
  const id = (await ctx?.params)?.id;
  if (!id) throw new NotFoundError('Comment not found');
  return id;
}

export const PATCH = handle(
  async (req: NextRequest, ctx?: RouteContext<{ id: string }>): Promise<NextResponse> => {
    const { user } = await requireSession(req);
    const input = await parseJson(req, commentUpdateSchema);
    return ok(await updateComment(await getId(ctx), user.id, input.body));
  },
);

/**
 * DELETE: comment author, post author, company MANAGER+ (company posts), or
 * platform ADMIN+. The service re-asserts the scope on the loaded row.
 */
export const DELETE = handle(
  async (req: NextRequest, ctx?: RouteContext<{ id: string }>): Promise<NextResponse> => {
    const { user } = await requireSession(req);
    const id = await getId(ctx);
    const comment = await prisma.comment.findUnique({
      where: { id },
      select: { authorId: true, post: { select: { authorId: true } } },
    });
    if (!comment) throw new NotFoundError('Comment not found');
    if (comment.authorId === user.id || comment.post.authorId === user.id) {
      await deleteComment(id, user.id);
    } else {
      await deleteComment(id, user.id, { moderatorId: user.id });
    }
    return ok({ ok: true });
  },
);
