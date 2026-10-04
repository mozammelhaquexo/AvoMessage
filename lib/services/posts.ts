/**
 * Posts service: World feed, creation (visibility incl. COMPANY), reads,
 * updates, deletes, likes, bookmarks, reposts.
 *
 * PRIVACY INVARIANT (hard rule): COMPANY and PRIVATE posts NEVER appear in
 * the World feed or world search. This is enforced in the Prisma where-clause
 * itself (see worldFeedWhere()), not by post-filtering in JS — see
 * tests/api/authz-matrix.test.ts.
 */
import { PostVisibility, type Post, type User } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  canViewPost,
  getCompanyMembership,
  isBlockedEitherWay,
  requireAdmin,
  requireCompanyMember,
} from '@/lib/permissions';
import {
  ForbiddenError,
  GoneError,
  NotFoundError,
  decodeCursor,
  encodeCursor,
} from '@/lib/api';
import { writeAuditLog } from '@/lib/audit';
import type { PostCreateInput, PostUpdateInput } from '@/lib/validation';
import { createNotification } from '@/lib/services/notifications';

// ─── Visibility scoping (Prisma-level) ──────────────────────────────────────

/**
 * Where-clause for the World feed / world search. Returns ONLY:
 *   - PUBLIC posts, plus
 *   - FOLLOWERS posts from the viewer themself or users they follow
 * COMPANY/PRIVATE posts are structurally impossible to match. Blocked and
 * muted authors are excluded. Suspended/deleted authors are excluded.
 */
export async function worldFeedWhere(viewerId: string | null) {
  const base = {
    deletedAt: null,
    author: { isActive: true, deletedAt: null },
  };
  if (!viewerId) {
    return { ...base, visibility: PostVisibility.PUBLIC };
  }
  const [following, blocked, muted] = await Promise.all([
    prisma.follow.findMany({ where: { followerId: viewerId }, select: { followingId: true } }),
    prisma.block.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
    }),
    prisma.mute.findMany({ where: { muterId: viewerId }, select: { mutedId: true } }),
  ]);
  const followingIds = following.map((f) => f.followingId);
  const excluded = new Set<string>();
  for (const b of blocked) {
    excluded.add(b.blockerId === viewerId ? b.blockedId : b.blockerId);
  }
  for (const m of muted) excluded.add(m.mutedId);

  return {
    ...base,
    authorId: excluded.size > 0 ? { notIn: [...excluded] } : undefined,
    OR: [
      { visibility: PostVisibility.PUBLIC },
      {
        visibility: PostVisibility.FOLLOWERS,
        OR: [{ authorId: viewerId }, { authorId: { in: followingIds } }],
      },
    ],
  };
}

// ─── Serialization ──────────────────────────────────────────────────────────

export interface SerializedPost {
  id: string;
  body: string;
  visibility: PostVisibility;
  companyId: string | null;
  author: {
    id: string;
    name: string;
    username: string;
    avatarUrl: string | null;
    isVerified: boolean;
    /** Platform role — drives the Admin chip next to the author's name. */
    platformRole: string;
    /** Company memberships — drives the Manager chip and company chips. */
    companies: Array<{ name: string; slug: string; role: string }>;
  };
  media: Array<{ id: string; url: string; kind: string; width: number | null; height: number | null }>;
  counts: { likes: number; comments: number; shares: number };
  viewerState: { liked: boolean; bookmarked: boolean } | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Post row with the author/media includes every feed serializer needs. */
export type PostWithIncludes = Post & {
  author: Pick<User, 'id' | 'name' | 'username' | 'avatarUrl' | 'isVerified' | 'platformRole'> & {
    /** Identity chips shown next to the author's name (Admin / Manager / company). */
    companyMemberships: Array<{
      role: string;
      company: { name: string; slug: string };
    }>;
  };
  media: Array<{ id: string; url: string; kind: string; width: number | null; height: number | null }>;
};

/**
 * The include clause that produces `PostWithIncludes`. Prefer this over
 * `include: { author: true }` — it fetches only the public author fields
 * (never passwordHash/tokens) plus ordered media.
 */
export const postFeedInclude = {
  author: {
    select: {
      id: true,
      name: true,
      username: true,
      avatarUrl: true,
      isVerified: true,
      platformRole: true,
      // Identity chips shown next to the author's name (Admin / Manager /
      // company). Prisma batches relation loads for findMany, so this does
      // not become an N+1 across a feed page.
      companyMemberships: {
        select: { role: true, company: { select: { name: true, slug: true } } },
      },
    },
  },
  media: { orderBy: { sortOrder: 'asc' as const } },
} as const;

/**
 * Synchronous serializer for call sites that already batched viewerState
 * (avoids N+1 like/bookmark lookups per post).
 */
export function serializePostWithViewerState(
  post: PostWithIncludes,
  viewerState: SerializedPost['viewerState'],
): SerializedPost {
  return {
    id: post.id,
    body: post.body,
    visibility: post.visibility,
    companyId: post.companyId,
    author: {
      id: post.author.id,
      name: post.author.name,
      username: post.author.username,
      avatarUrl: post.author.avatarUrl,
      isVerified: post.author.isVerified,
      platformRole: post.author.platformRole,
      companies: post.author.companyMemberships.map((m) => ({
        name: m.company.name,
        slug: m.company.slug,
        role: m.role,
      })),
    },
    media: post.media.map((m) => ({ id: m.id, url: m.url, kind: m.kind, width: m.width, height: m.height })),
    counts: { likes: post.likeCount, comments: post.commentCount, shares: post.shareCount },
    viewerState,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

export async function serializePost(
  post: PostWithIncludes,
  viewerId: string | null,
): Promise<SerializedPost> {
  let viewerState: SerializedPost['viewerState'] = null;
  if (viewerId) {
    const [like, bookmark] = await Promise.all([
      prisma.like.findUnique({
        where: { userId_postId: { userId: viewerId, postId: post.id } },
      }),
      prisma.bookmark.findUnique({
        where: { userId_postId: { userId: viewerId, postId: post.id } },
      }),
    ]);
    viewerState = { liked: !!like, bookmarked: !!bookmark };
  }
  return serializePostWithViewerState(post, viewerState);
}

const postInclude = postFeedInclude;

// ─── Feed ───────────────────────────────────────────────────────────────────

export interface FeedOpts {
  limit: number;
  cursor: string | null;
}

export async function getWorldFeed(viewerId: string | null, opts: FeedOpts) {
  const scope = await worldFeedWhere(viewerId);
  let fullWhere: Record<string, unknown> = scope;
  if (opts.cursor) {
    const { createdAt, id } = decodeCursor(opts.cursor);
    fullWhere = {
      AND: [
        scope,
        {
          OR: [
            { createdAt: { lt: createdAt } },
            { createdAt: { equals: createdAt }, id: { lt: id } },
          ],
        },
      ],
    };
  }
  const rows = await prisma.post.findMany({
    where: fullWhere,
    include: postInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
  });
  const hasMore = rows.length > opts.limit;
  const page = (hasMore ? rows.slice(0, opts.limit) : rows) as PostWithIncludes[];
  const data = await Promise.all(page.map((p) => serializePost(p, viewerId)));
  const nextCursor =
    hasMore && page.length > 0
      ? encodeCursor(page[page.length - 1]!.createdAt, page[page.length - 1]!.id)
      : null;
  return { data, nextCursor };
}

// ─── Create ─────────────────────────────────────────────────────────────────

const HASHTAG_RE = /#([\p{L}\p{N}_]{1,64})/gu;
const MENTION_RE = /@([a-zA-Z0-9_]{3,24})/g;

export async function createPost(authorId: string, input: PostCreateInput): Promise<SerializedPost> {
  if (input.visibility === PostVisibility.COMPANY) {
    // Membership check BEFORE anything is written.
    await requireCompanyMember(authorId, input.companyId!);
  }

  const hashtags = [...new Set([...input.body.matchAll(HASHTAG_RE)].map((m) => m[1]!.toLowerCase()))].slice(0, 10);
  const mentions = [...new Set([...input.body.matchAll(MENTION_RE)].map((m) => m[1]!))].slice(0, 10);

  const post = await prisma.$transaction(async (tx) => {
    const created = await tx.post.create({
      data: {
        authorId,
        body: input.body,
        visibility: input.visibility,
        companyId: input.visibility === PostVisibility.COMPANY ? input.companyId! : null,
      },
      include: postInclude,
    });

    for (const tag of hashtags) {
      const hashtag = await tx.hashtag.upsert({
        where: { tag },
        create: { tag, usageCount: 1 },
        update: { usageCount: { increment: 1 } },
      });
      await tx.postHashtag.create({ data: { postId: created.id, hashtagId: hashtag.id } });
    }

    if (mentions.length > 0) {
      const users = await tx.user.findMany({
        where: { username: { in: mentions }, isActive: true, deletedAt: null },
        select: { id: true, username: true },
      });
      for (const u of users) {
        if (u.id === authorId) continue;
        if (await isBlockedEitherWay(authorId, u.id)) continue;
        await tx.mention.create({ data: { postId: created.id, mentionedUserId: u.id } });
      }
    }
    return created;
  });

  // Notify mentioned users (outside the write transaction).
  const mentionRows = await prisma.mention.findMany({
    where: { postId: post.id },
    select: { mentionedUserId: true },
  });
  for (const m of mentionRows) {
    await createNotification({
      userId: m.mentionedUserId,
      actorId: authorId,
      type: 'MENTION',
      entityType: 'post',
      entityId: post.id,
    }).catch(() => undefined);
  }

  return serializePost(post as PostWithIncludes, authorId);
}

// ─── Read / update / delete ─────────────────────────────────────────────────

async function getPostOrThrow(id: string) {
  const post = await prisma.post.findUnique({ where: { id }, include: postInclude });
  if (!post) throw new NotFoundError('Post not found');
  if (post.deletedAt) throw new GoneError('This post was deleted');
  return post as PostWithIncludes;
}

export async function getPostById(id: string, viewerId: string | null): Promise<SerializedPost> {
  const post = await getPostOrThrow(id);
  const visible = await canViewPost(viewerId ? { id: viewerId } : null, {
    id: post.id,
    authorId: post.authorId,
    visibility: post.visibility,
    companyId: post.companyId,
    deletedAt: null,
  });
  // 404 (not 403) to avoid leaking existence of invisible posts.
  if (!visible) throw new NotFoundError('Post not found');
  return serializePost(post, viewerId);
}

export async function updatePost(
  id: string,
  authorId: string,
  input: PostUpdateInput,
): Promise<SerializedPost> {
  const post = await getPostOrThrow(id);
  if (post.authorId !== authorId) {
    throw new ForbiddenError('NOT_POST_AUTHOR', 'Only the author can edit this post');
  }
  if (input.visibility === PostVisibility.COMPANY && post.companyId) {
    await requireCompanyMember(authorId, post.companyId);
  }
  const updated = await prisma.post.update({
    where: { id },
    data: {
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    },
    include: postInclude,
  });
  return serializePost(updated as PostWithIncludes, authorId);
}

export interface DeletePostOpts {
  /** Set when the caller is a platform admin or a company manager with scope. */
  moderatorId?: string;
  reason?: string;
}

export async function deletePost(id: string, authorId: string, opts: DeletePostOpts = {}): Promise<void> {
  const post = await getPostOrThrow(id);
  const isAuthor = post.authorId === authorId;
  if (!isAuthor && !opts.moderatorId) {
    throw new ForbiddenError('NOT_POST_AUTHOR', 'Only the author can delete this post');
  }
  // Defense in depth: re-assert the moderator's scope on the loaded row.
  if (!isAuthor && opts.moderatorId) {
    if (post.visibility === PostVisibility.COMPANY && post.companyId) {
      const membership = await getCompanyMembership(opts.moderatorId, post.companyId);
      if (!membership || (membership.role !== 'MANAGER' && membership.role !== 'OWNER')) {
        throw new ForbiddenError('NOT_POST_AUTHOR', 'Only the author can delete this post');
      }
    } else {
      const moderator = await prisma.user.findUnique({ where: { id: opts.moderatorId } });
      if (!moderator) throw new ForbiddenError('NOT_POST_AUTHOR', 'Only the author can delete this post');
      requireAdmin(moderator);
    }
  }
  await prisma.post.update({ where: { id }, data: { deletedAt: new Date() } });
  if (opts.moderatorId && !isAuthor) {
    await writeAuditLog({
      actorId: opts.moderatorId,
      action: 'moderation.post_deleted',
      entityType: 'post',
      entityId: id,
      metadata: { reason: opts.reason ?? null, authorId: post.authorId },
    });
  }
}

// ─── Likes / bookmarks ──────────────────────────────────────────────────────

async function requireVisiblePost(id: string, viewerId: string): Promise<PostWithIncludes> {
  const post = await getPostOrThrow(id);
  const visible = await canViewPost({ id: viewerId }, {
    id: post.id,
    authorId: post.authorId,
    visibility: post.visibility,
    companyId: post.companyId,
    deletedAt: null,
  });
  if (!visible) throw new NotFoundError('Post not found');
  return post;
}

export async function likePost(id: string, viewerId: string) {
  const post = await requireVisiblePost(id, viewerId);
  if (post.authorId === viewerId) {
    // Liking your own post is allowed (counts as engagement); no notification.
  }
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.like.findUnique({
      where: { userId_postId: { userId: viewerId, postId: id } },
    });
    if (existing) {
      await tx.like.delete({ where: { userId_postId: { userId: viewerId, postId: id } } });
      await tx.post.update({ where: { id }, data: { likeCount: { decrement: 1 } } });
      return { liked: false, changed: true };
    }
    await tx.like.create({ data: { userId: viewerId, postId: id } });
    await tx.post.update({ where: { id }, data: { likeCount: { increment: 1 } } });
    return { liked: true, changed: true };
  });
  if (result.liked && result.changed && post.authorId !== viewerId) {
    await createNotification({
      userId: post.authorId,
      actorId: viewerId,
      type: 'LIKE',
      entityType: 'post',
      entityId: id,
    }).catch(() => undefined);
  }
  const likeCount = (await prisma.post.findUnique({ where: { id }, select: { likeCount: true } }))!.likeCount;
  return { liked: result.liked, likeCount };
}

export async function unlikePost(id: string, viewerId: string) {
  await requireVisiblePost(id, viewerId);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.like.findUnique({
      where: { userId_postId: { userId: viewerId, postId: id } },
    });
    if (!existing) return;
    await tx.like.delete({ where: { userId_postId: { userId: viewerId, postId: id } } });
    await tx.post.update({ where: { id }, data: { likeCount: { decrement: 1 } } });
  });
  const likeCount = (await prisma.post.findUnique({ where: { id }, select: { likeCount: true } }))!.likeCount;
  return { liked: false, likeCount };
}

export async function bookmarkPost(id: string, viewerId: string) {
  await requireVisiblePost(id, viewerId);
  const existing = await prisma.bookmark.findUnique({
    where: { userId_postId: { userId: viewerId, postId: id } },
  });
  if (existing) {
    await prisma.bookmark
      .delete({ where: { userId_postId: { userId: viewerId, postId: id } } })
      .catch(() => undefined);
    return { bookmarked: false };
  }
  await prisma.bookmark
    .upsert({
      where: { userId_postId: { userId: viewerId, postId: id } },
      create: { userId: viewerId, postId: id },
      update: {},
    })
    .catch(() => undefined);
  return { bookmarked: true };
}

export async function unbookmarkPost(id: string, viewerId: string) {
  await prisma.bookmark
    .delete({ where: { userId_postId: { userId: viewerId, postId: id } } })
    .catch(() => undefined);
  return { bookmarked: false };
}

export async function listBookmarks(viewerId: string, opts: FeedOpts) {
  const where: Record<string, unknown> = {
    userId: viewerId,
    post: { deletedAt: null, author: { isActive: true, deletedAt: null } },
  };
  if (opts.cursor) {
    const { createdAt } = decodeCursor(opts.cursor);
    where.createdAt = { lt: createdAt };
  }
  const rows = await prisma.bookmark.findMany({
    where,
    include: { post: { include: postInclude } },
    orderBy: { createdAt: 'desc' },
    take: opts.limit + 1,
  });
  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  // Re-check visibility (a post may have become COMPANY/PRIVATE after bookmarking).
  const data: SerializedPost[] = [];
  for (const r of page) {
    const p = r.post as PostWithIncludes;
    const visible = await canViewPost({ id: viewerId }, {
      id: p.id, authorId: p.authorId, visibility: p.visibility, companyId: p.companyId, deletedAt: null,
    });
    if (visible) data.push(await serializePost(p, viewerId));
  }
  return {
    data,
    nextCursor:
      hasMore && page.length > 0
        ? encodeCursor(page[page.length - 1]!.createdAt, page[page.length - 1]!.postId)
        : null,
  };
}

// ─── Repost ─────────────────────────────────────────────────────────────────

export async function repost(id: string, viewerId: string): Promise<SerializedPost> {
  const original = await requireVisiblePost(id, viewerId);
  if (original.visibility === PostVisibility.PRIVATE) {
    throw new ForbiddenError('CANNOT_REPOST', 'Private posts cannot be reposted');
  }
  const reposted = await prisma.$transaction(async (tx) => {
    await tx.post.update({ where: { id }, data: { shareCount: { increment: 1 } } });
    return tx.post.create({
      data: {
        authorId: viewerId,
        body: original.body,
        visibility: PostVisibility.PUBLIC,
      },
      include: postInclude,
    });
  });
  return serializePost(reposted as PostWithIncludes, viewerId);
}
