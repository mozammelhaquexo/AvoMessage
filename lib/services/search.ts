/**
 * Unified search: users, posts, hashtags, companies.
 *
 * Permission filtering is applied at the query level:
 * - posts: World-feed visibility scoping (COMPANY/PRIVATE never leak),
 * - users: suspended/deleted excluded,
 * - companies: only companies the viewer belongs to.
 */
import { prisma } from '@/lib/db';
import { postFeedInclude, worldFeedWhere, serializePost } from '@/lib/services/posts';
import { decodeCursor, encodeCursor } from '@/lib/api';

export type SearchType = 'users' | 'posts' | 'hashtags' | 'companies';

export interface SearchOpts {
  limit: number;
  cursor: string | null;
}

function summarizeUser(u: {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  isVerified: boolean;
}) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    isVerified: u.isVerified,
  };
}

export async function searchUsers(q: string, opts: SearchOpts) {
  const rows = await prisma.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      OR: [
        { username: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, username: true, avatarUrl: true, bio: true, isVerified: true },
    orderBy: { username: 'asc' },
    take: Math.min(opts.limit, 20),
  });
  return { data: rows.map(summarizeUser), nextCursor: null as string | null };
}

export async function searchPosts(q: string, viewerId: string | null, opts: SearchOpts) {
  const scope = await worldFeedWhere(viewerId);
  let where: Record<string, unknown> = {
    AND: [scope, { body: { contains: q, mode: 'insensitive' } }],
  };
  if (opts.cursor) {
    const { createdAt, id } = decodeCursor(opts.cursor);
    where = {
      AND: [
        scope,
        { body: { contains: q, mode: 'insensitive' } },
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
    where,
    // Must be postFeedInclude: serializePost reads author.platformRole and
    // author.companyMemberships for the identity chips. A hand-written
    // include silently omits them and the serializer throws at runtime —
    // which is exactly how /api/search started returning 500.
    include: postFeedInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
  });
  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  return {
    data: await Promise.all(page.map((p) => serializePost(p, viewerId))),
    nextCursor:
      hasMore && page.length > 0
        ? encodeCursor(page[page.length - 1]!.createdAt, page[page.length - 1]!.id)
        : null,
  };
}

export async function searchHashtags(q: string, opts: SearchOpts) {
  const tag = q.replace(/^#/, '').toLowerCase();
  const rows = await prisma.hashtag.findMany({
    where: { tag: { startsWith: tag } },
    orderBy: { usageCount: 'desc' },
    take: Math.min(opts.limit, 20),
  });
  return {
    data: rows.map((h) => ({ tag: h.tag, usageCount: h.usageCount })),
    nextCursor: null as string | null,
  };
}

export async function searchCompanies(q: string, viewerId: string, opts: SearchOpts) {
  const rows = await prisma.companyMember.findMany({
    where: {
      userId: viewerId,
      company: {
        isActive: true,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
        ],
      },
    },
    include: {
      company: { select: { id: true, name: true, slug: true, logoUrl: true, description: true } },
    },
    take: Math.min(opts.limit, 20),
  });
  return {
    data: rows.map((r) => ({ ...r.company, viewerRole: r.role })),
    nextCursor: null as string | null,
  };
}

export async function search(
  q: string,
  type: SearchType,
  viewerId: string | null,
  opts: SearchOpts,
) {
  switch (type) {
    case 'users':
      return searchUsers(q, opts);
    case 'posts':
      return searchPosts(q, viewerId, opts);
    case 'hashtags':
      return searchHashtags(q, opts);
    case 'companies':
      if (!viewerId) return { data: [], nextCursor: null };
      return searchCompanies(q, viewerId, opts);
  }
}

/** Top 20 hashtags by 7-day weighted usage. */
export async function trendingHashtags() {
  const rows = await prisma.hashtag.findMany({
    orderBy: { usageCount: 'desc' },
    take: 20,
  });
  return rows.map((h) => ({ tag: h.tag, usageCount: h.usageCount }));
}

/** Posts for a hashtag, visibility-filtered like the World feed. */
export async function hashtagTimeline(tag: string, viewerId: string | null, opts: SearchOpts) {
  const hashtag = await prisma.hashtag.findUnique({ where: { tag: tag.toLowerCase() } });
  if (!hashtag) return { data: [], nextCursor: null };
  const scope = await worldFeedWhere(viewerId);
  let where: Record<string, unknown> = {
    AND: [scope, { hashtags: { some: { hashtagId: hashtag.id } } }],
  };
  if (opts.cursor) {
    const { createdAt, id } = decodeCursor(opts.cursor);
    where = {
      AND: [
        scope,
        { hashtags: { some: { hashtagId: hashtag.id } } },
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
    where,
    // Must be postFeedInclude: serializePost reads author.platformRole and
    // author.companyMemberships for the identity chips. A hand-written
    // include silently omits them and the serializer throws at runtime —
    // which is exactly how /api/search started returning 500.
    include: postFeedInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
  });
  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  return {
    data: await Promise.all(page.map((p) => serializePost(p, viewerId))),
    nextCursor:
      hasMore && page.length > 0
        ? encodeCursor(page[page.length - 1]!.createdAt, page[page.length - 1]!.id)
        : null,
  };
}
