/**
 * Comments service: threaded comments with a hard depth limit of 3 levels
 * (comment → reply → reply-to-reply), pagination, likes, edit/delete with
 * ownership + moderation rules.
 */
import { PostVisibility } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  canViewPost,
  getCompanyMembership,
  requireAdmin,
} from '@/lib/permissions';
import {
  ForbiddenError,
  GoneError,
  NotFoundError,
  decodeCursor,
  encodeCursor,
} from '@/lib/api';
import { writeAuditLog } from '@/lib/audit';
import type { CommentCreateInput } from '@/lib/validation';
import { createNotification } from '@/lib/services/notifications';

export const MAX_COMMENT_DEPTH = 3; // levels: 0,1,2 — replies beyond depth 2 are rejected

export interface SerializedComment {
  id: string;
  body: string;
  author: { id: string; name: string; username: string; avatarUrl: string | null };
  likeCount: number;
  liked: boolean | null;
  parentId: string | null;
  replies: SerializedComment[];
  createdAt: Date;
  updatedAt: Date;
}

type CommentRow = {
  id: string;
  body: string;
  parentId: string | null;
  likeCount: number;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; name: string; username: string; avatarUrl: string | null };
};

async function serializeComment(
  row: CommentRow,
  viewerId: string | null,
  replies: SerializedComment[] = [],
): Promise<SerializedComment> {
  let liked: boolean | null = null;
  if (viewerId) {
    const like = await prisma.commentLike.findUnique({
      where: { userId_commentId: { userId: viewerId, commentId: row.id } },
    });
    liked = !!like;
  }
  return {
    id: row.id,
    body: row.body,
    author: row.author,
    likeCount: row.likeCount,
    liked,
    parentId: row.parentId,
    replies,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function requireVisiblePost(postId: string, viewerId: string | null) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, authorId: true, visibility: true, companyId: true, deletedAt: true },
  });
  if (!post) throw new NotFoundError('Post not found');
  if (post.deletedAt) throw new GoneError('This post was deleted');
  const visible = await canViewPost(viewerId ? { id: viewerId } : null, {
    id: post.id,
    authorId: post.authorId,
    visibility: post.visibility,
    companyId: post.companyId,
    deletedAt: null,
  });
  if (!visible) throw new NotFoundError('Post not found');
  return post;
}

/** Depth of a comment: 0 for top-level. Walks the parent chain. */
async function commentDepth(commentId: string): Promise<number> {
  let depth = 0;
  let current: string | null = commentId;
  while (current) {
    const row: { parentId: string | null } | null = await prisma.comment.findUnique({
      where: { id: current },
      select: { parentId: true },
    });
    if (!row?.parentId) break;
    depth += 1;
    current = row.parentId;
    if (depth > MAX_COMMENT_DEPTH) break;
  }
  return depth;
}

// ─── List (threaded, paginated top-level) ────────────────────────────────────

export async function listComments(
  postId: string,
  viewerId: string | null,
  opts: { limit: number; cursor: string | null },
) {
  await requireVisiblePost(postId, viewerId);

  const where: Record<string, unknown> = { postId, parentId: null, deletedAt: null };
  if (opts.cursor) {
    const { createdAt } = decodeCursor(opts.cursor);
    where.createdAt = { lt: createdAt };
  }
  const topRows = (await prisma.comment.findMany({
    where,
    include: { author: { select: { id: true, name: true, username: true, avatarUrl: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
  })) as CommentRow[];

  const hasMore = topRows.length > opts.limit;
  const page = hasMore ? topRows.slice(0, opts.limit) : topRows;

  const data: SerializedComment[] = [];
  for (const row of page) {
    const replies = await loadReplies(row.id, viewerId, 1);
    data.push(await serializeComment(row, viewerId, replies));
  }
  return {
    data,
    nextCursor:
      hasMore && page.length > 0
        ? encodeCursor(page[page.length - 1]!.createdAt, page[page.length - 1]!.id)
        : null,
  };
}

/** Recursively load replies up to MAX_COMMENT_DEPTH. */
async function loadReplies(
  parentId: string,
  viewerId: string | null,
  depth: number,
): Promise<SerializedComment[]> {
  if (depth >= MAX_COMMENT_DEPTH) return [];
  const rows = (await prisma.comment.findMany({
    where: { parentId, deletedAt: null },
    include: { author: { select: { id: true, name: true, username: true, avatarUrl: true } } },
    orderBy: { createdAt: 'asc' },
    take: 10,
  })) as CommentRow[];
  const out: SerializedComment[] = [];
  for (const row of rows) {
    const nested = await loadReplies(row.id, viewerId, depth + 1);
    out.push(await serializeComment(row, viewerId, nested));
  }
  return out;
}

// ─── Create ─────────────────────────────────────────────────────────────────

export async function createComment(
  postId: string,
  authorId: string,
  input: CommentCreateInput,
) {
  const post = await requireVisiblePost(postId, authorId);

  if (input.parentId) {
    const parent = await prisma.comment.findUnique({
      where: { id: input.parentId },
      select: { id: true, postId: true, deletedAt: true },
    });
    if (!parent || parent.postId !== postId || parent.deletedAt) {
      throw new NotFoundError('Parent comment not found');
    }
    const depth = await commentDepth(parent.id);
    if (depth + 1 >= MAX_COMMENT_DEPTH) {
      throw new ForbiddenError('MAX_DEPTH', `Replies are limited to ${MAX_COMMENT_DEPTH} levels`);
    }
  }

  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: {
        postId,
        authorId,
        body: input.body,
        parentId: input.parentId ?? null,
      },
      include: { author: { select: { id: true, name: true, username: true, avatarUrl: true } } },
    });
    await tx.post.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } });
    return created;
  });

  if (post.authorId !== authorId) {
    await createNotification({
      userId: post.authorId,
      actorId: authorId,
      type: 'COMMENT',
      entityType: 'comment',
      entityId: comment.id,
    }).catch(() => undefined);
  }

  return serializeComment(comment as CommentRow, authorId);
}

// ─── Update / delete ────────────────────────────────────────────────────────

async function getCommentOrThrow(id: string) {
  const comment = await prisma.comment.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true, username: true, avatarUrl: true } },
      post: { select: { id: true, authorId: true, visibility: true, companyId: true } },
    },
  });
  if (!comment) throw new NotFoundError('Comment not found');
  if (comment.deletedAt) throw new GoneError('This comment was deleted');
  return comment;
}

export async function updateComment(id: string, authorId: string, body: string) {
  const comment = await getCommentOrThrow(id);
  if (comment.authorId !== authorId) {
    throw new ForbiddenError('NOT_COMMENT_AUTHOR', 'Only the author can edit this comment');
  }
  const updated = await prisma.comment.update({
    where: { id },
    data: { body },
    include: { author: { select: { id: true, name: true, username: true, avatarUrl: true } } },
  });
  return serializeComment(updated as CommentRow, authorId);
}

export interface DeleteCommentOpts {
  moderatorId?: string;
  reason?: string;
}

export async function deleteComment(id: string, requesterId: string, opts: DeleteCommentOpts = {}) {
  const comment = await getCommentOrThrow(id);
  const isAuthor = comment.authorId === requesterId;
  const isPostAuthor = comment.post.authorId === requesterId;

  let allowed = isAuthor || isPostAuthor;
  if (!allowed && opts.moderatorId) {
    if (comment.post.visibility === PostVisibility.COMPANY && comment.post.companyId) {
      const membership = await getCompanyMembership(opts.moderatorId, comment.post.companyId);
      allowed = !!membership && (membership.role === 'MANAGER' || membership.role === 'OWNER');
    } else {
      const moderator = await prisma.user.findUnique({ where: { id: opts.moderatorId } });
      if (moderator) {
        try {
          requireAdmin(moderator);
          allowed = true;
        } catch {
          allowed = false;
        }
      }
    }
  }
  if (!allowed) {
    throw new ForbiddenError('NOT_COMMENT_AUTHOR', 'You cannot delete this comment');
  }

  await prisma.$transaction(async (tx) => {
    await tx.comment.update({ where: { id }, data: { deletedAt: new Date() } });
    await tx.post.update({ where: { id: comment.postId }, data: { commentCount: { decrement: 1 } } });
    // Soft-delete nested replies too (they lose their context).
    await tx.comment.updateMany({ where: { parentId: id, deletedAt: null }, data: { deletedAt: new Date() } });
  });

  if (opts.moderatorId && !isAuthor && !isPostAuthor) {
    await writeAuditLog({
      actorId: opts.moderatorId,
      action: 'moderation.comment_deleted',
      entityType: 'comment',
      entityId: id,
      metadata: { reason: opts.reason ?? null, authorId: comment.authorId },
    });
  }
}

// ─── Likes ──────────────────────────────────────────────────────────────────

export async function likeComment(id: string, viewerId: string) {
  const comment = await getCommentOrThrow(id);
  await requireVisiblePost(comment.postId, viewerId);
  const liked = await prisma.$transaction(async (tx) => {
    const existing = await tx.commentLike.findUnique({
      where: { userId_commentId: { userId: viewerId, commentId: id } },
    });
    if (existing) {
      await tx.commentLike.delete({
        where: { userId_commentId: { userId: viewerId, commentId: id } },
      });
      await tx.comment.update({ where: { id }, data: { likeCount: { decrement: 1 } } });
      return false;
    }
    await tx.commentLike.create({ data: { userId: viewerId, commentId: id } });
    await tx.comment.update({ where: { id }, data: { likeCount: { increment: 1 } } });
    return true;
  });
  if (liked && comment.authorId !== viewerId) {
    await createNotification({
      userId: comment.authorId,
      actorId: viewerId,
      type: 'LIKE',
      entityType: 'comment',
      entityId: id,
    }).catch(() => undefined);
  }
  const likeCount = (await prisma.comment.findUnique({ where: { id }, select: { likeCount: true } }))!.likeCount;
  return { liked, likeCount };
}

export async function unlikeComment(id: string, viewerId: string) {
  const comment = await getCommentOrThrow(id);
  await requireVisiblePost(comment.postId, viewerId);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.commentLike.findUnique({
      where: { userId_commentId: { userId: viewerId, commentId: id } },
    });
    if (!existing) return;
    await tx.commentLike.delete({ where: { userId_commentId: { userId: viewerId, commentId: id } } });
    await tx.comment.update({ where: { id }, data: { likeCount: { decrement: 1 } } });
  });
  const likeCount = (await prisma.comment.findUnique({ where: { id }, select: { likeCount: true } }))!.likeCount;
  return { liked: false, likeCount };
}
