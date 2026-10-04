/**
 * Users & social graph service: profiles (privacy-aware), follow/unfollow,
 * block/unblock, mute/unmute, followers/following lists.
 */
import { prisma } from '@/lib/db';
import {
  canViewProfile,
  isBlockedEitherWay,
  isFollowing,
  isMuted,
} from '@/lib/permissions';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api';
import { decodeCursor, encodeCursor } from '@/lib/api';
import { createNotification } from '@/lib/services/notifications';
import type { User } from '@prisma/client';
import type { UpdateProfileInput } from '@/lib/validation';

export interface ViewerState {
  following: boolean;
  followedBy: boolean;
  blocked: boolean; // viewer blocked this user
  blockedBy: boolean; // this user blocked the viewer
  muted: boolean;
  self: boolean;
}

export async function getViewerState(viewerId: string | null, targetId: string): Promise<ViewerState | null> {
  if (!viewerId) return null;
  if (viewerId === targetId) {
    return { following: false, followedBy: false, blocked: false, blockedBy: false, muted: false, self: true };
  }
  const [following, followedBy, blockedRow, blockedByRow, muted] = await Promise.all([
    isFollowing(viewerId, targetId),
    isFollowing(targetId, viewerId),
    prisma.block.findUnique({ where: { blockerId_blockedId: { blockerId: viewerId, blockedId: targetId } } }),
    prisma.block.findUnique({ where: { blockerId_blockedId: { blockerId: targetId, blockedId: viewerId } } }),
    isMuted(viewerId, targetId),
  ]);
  return {
    following,
    followedBy,
    blocked: !!blockedRow,
    blockedBy: !!blockedByRow,
    muted,
    self: false,
  };
}

export interface PublicProfile {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  bio: string | null;
  website: string | null;
  location: string | null;
  isPrivate: boolean;
  isVerified: boolean;
  /** Platform role — drives the Admin chip. A platform-wide marker, so it is
   *  shown even on a limited (private-account) profile. */
  platformRole: string;
  /** Company memberships — drives the Manager chip and company chips.
   *  Empty on a limited profile: which companies someone belongs to is
   *  private-account information, not a public badge. */
  companies: Array<{ name: string; slug: string; role: string }>;
  createdAt: Date;
  counts?: { followers: number; following: number; posts: number };
  viewerState: ViewerState | null;
}

/**
 * Public profile with privacy: private accounts show a limited profile to
 * non-followers; blocked-either-way → 404 (no existence leak to blockers).
 */
export async function getProfileByUsername(
  username: string,
  viewerId: string | null,
): Promise<PublicProfile> {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || user.deletedAt || !user.isActive) throw new NotFoundError('User not found');

  const visibility = await canViewProfile(
    viewerId ? { id: viewerId } : null,
    { id: user.id, isPrivate: user.isPrivate },
  );
  if (visibility === 'none') throw new NotFoundError('User not found');

  const viewerState = await getViewerState(viewerId, user.id);
  const base: PublicProfile = {
    id: user.id,
    name: user.name,
    username: user.username,
    avatarUrl: user.avatarUrl,
    coverUrl: user.coverUrl,
    bio: visibility === 'full' ? user.bio : null,
    website: visibility === 'full' ? user.website : null,
    location: visibility === 'full' ? user.location : null,
    isPrivate: user.isPrivate,
    isVerified: user.isVerified,
    platformRole: user.platformRole,
    companies: [],
    createdAt: user.createdAt,
    viewerState,
  };
  if (visibility === 'full') {
    const [followers, following, posts, memberships] = await Promise.all([
      prisma.follow.count({ where: { followingId: user.id } }),
      prisma.follow.count({ where: { followerId: user.id } }),
      prisma.post.count({ where: { authorId: user.id, deletedAt: null } }),
      prisma.companyMember.findMany({
        where: { userId: user.id, company: { isActive: true } },
        select: { role: true, company: { select: { name: true, slug: true } } },
      }),
    ]);
    base.counts = { followers, following, posts };
    base.companies = memberships.map((m) => ({
      name: m.company.name,
      slug: m.company.slug,
      role: m.role,
    }));
  }
  return base;
}

/** Full own profile for /api/users/me (includes private fields + counts). */
export async function getOwnProfile(user: User) {
  const [followers, following, posts] = await Promise.all([
    prisma.follow.count({ where: { followingId: user.id } }),
    prisma.follow.count({ where: { followerId: user.id } }),
    prisma.post.count({ where: { authorId: user.id, deletedAt: null } }),
  ]);
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
    coverUrl: user.coverUrl,
    bio: user.bio,
    website: user.website,
    location: user.location,
    isPrivate: user.isPrivate,
    isVerified: user.isVerified,
    emailVerified: !!user.emailVerifiedAt,
    platformRole: user.platformRole,
    createdAt: user.createdAt,
    counts: { followers, following, posts },
  };
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.bio !== undefined ? { bio: input.bio ?? null } : {}),
      ...(input.website !== undefined ? { website: input.website ?? null } : {}),
      ...(input.location !== undefined ? { location: input.location ?? null } : {}),
      ...(input.isPrivate !== undefined ? { isPrivate: input.isPrivate } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl ?? null } : {}),
      ...(input.coverUrl !== undefined ? { coverUrl: input.coverUrl ?? null } : {}),
    },
  });
  return getOwnProfile(user);
}

// ─── Follow ─────────────────────────────────────────────────────────────────

export async function resolveUserByUsername(username: string) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || user.deletedAt || !user.isActive) throw new NotFoundError('User not found');
  return user;
}

export async function followUser(viewerId: string, targetUsername: string): Promise<{ following: boolean }> {
  const target = await resolveUserByUsername(targetUsername);
  if (target.id === viewerId) throw new ConflictError('CANNOT_FOLLOW_SELF', 'You cannot follow yourself');
  if (await isBlockedEitherWay(viewerId, target.id)) {
    throw new ForbiddenError('BLOCKED', 'You cannot follow this user');
  }
  const existing = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: viewerId, followingId: target.id } },
  });
  if (!existing) {
    await prisma.follow.create({ data: { followerId: viewerId, followingId: target.id } });
    await createNotification({
      userId: target.id,
      actorId: viewerId,
      type: 'FOLLOW',
      entityType: 'user',
      entityId: viewerId,
    }).catch(() => undefined);
  }
  return { following: true };
}

export async function unfollowUser(viewerId: string, targetUsername: string): Promise<{ following: boolean }> {
  const target = await resolveUserByUsername(targetUsername);
  await prisma.follow
    .delete({ where: { followerId_followingId: { followerId: viewerId, followingId: target.id } } })
    .catch(() => undefined);
  return { following: false };
}

// ─── Block / mute ───────────────────────────────────────────────────────────

export async function blockUser(viewerId: string, targetUsername: string): Promise<{ blocked: boolean }> {
  const target = await resolveUserByUsername(targetUsername);
  if (target.id === viewerId) throw new ConflictError('CANNOT_BLOCK_SELF', 'You cannot block yourself');
  await prisma.$transaction([
    prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId: viewerId, blockedId: target.id } },
      create: { blockerId: viewerId, blockedId: target.id },
      update: {},
    }),
    // Blocking severs the follow graph both ways.
    prisma.follow.deleteMany({
      where: {
        OR: [
          { followerId: viewerId, followingId: target.id },
          { followerId: target.id, followingId: viewerId },
        ],
      },
    }),
  ]);
  return { blocked: true };
}

export async function unblockUser(viewerId: string, targetUsername: string): Promise<{ blocked: boolean }> {
  const target = await resolveUserByUsername(targetUsername);
  await prisma.block
    .delete({ where: { blockerId_blockedId: { blockerId: viewerId, blockedId: target.id } } })
    .catch(() => undefined);
  return { blocked: false };
}

export async function muteUser(viewerId: string, targetUsername: string): Promise<{ muted: boolean }> {
  const target = await resolveUserByUsername(targetUsername);
  if (target.id === viewerId) throw new ConflictError('CANNOT_MUTE_SELF', 'You cannot mute yourself');
  await prisma.mute.upsert({
    where: { muterId_mutedId: { muterId: viewerId, mutedId: target.id } },
    create: { muterId: viewerId, mutedId: target.id },
    update: {},
  });
  return { muted: true };
}

export async function unmuteUser(viewerId: string, targetUsername: string): Promise<{ muted: boolean }> {
  const target = await resolveUserByUsername(targetUsername);
  await prisma.mute
    .delete({ where: { muterId_mutedId: { muterId: viewerId, mutedId: target.id } } })
    .catch(() => undefined);
  return { muted: false };
}

// ─── Followers / following ──────────────────────────────────────────────────

interface ListOpts {
  limit: number;
  cursor: string | null;
}

function summarizeUser(u: { id: string; name: string; username: string; avatarUrl: string | null; isVerified: boolean }) {
  return { id: u.id, name: u.name, username: u.username, avatarUrl: u.avatarUrl, isVerified: u.isVerified };
}

export async function listFollowers(username: string, viewerId: string | null, opts: ListOpts) {
  const user = await resolveUserByUsername(username);
  const visibility = await canViewProfile(viewerId ? { id: viewerId } : null, {
    id: user.id,
    isPrivate: user.isPrivate,
  });
  if (visibility === 'none') throw new NotFoundError('User not found');
  if (user.isPrivate && visibility !== 'full') {
    throw new ForbiddenError('PRIVATE_ACCOUNT', 'This account is private');
  }
  const where: Record<string, unknown> = { followingId: user.id };
  if (opts.cursor) {
    const { createdAt } = decodeCursor(opts.cursor);
    where.follower = { createdAt: { lt: createdAt } };
  }
  // Cursor on follow.createdAt — fetch one extra to detect next page.
  const rows = await prisma.follow.findMany({
    where,
    include: { follower: true },
    orderBy: { createdAt: 'desc' },
    take: opts.limit + 1,
  });
  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  return {
    data: page.map((r) => summarizeUser(r.follower)),
    nextCursor:
      hasMore && page.length > 0
        ? encodeCursor(page[page.length - 1]!.createdAt, page[page.length - 1]!.followerId)
        : null,
  };
}

export async function listFollowing(username: string, viewerId: string | null, opts: ListOpts) {
  const user = await resolveUserByUsername(username);
  const visibility = await canViewProfile(viewerId ? { id: viewerId } : null, {
    id: user.id,
    isPrivate: user.isPrivate,
  });
  if (visibility === 'none') throw new NotFoundError('User not found');
  if (user.isPrivate && visibility !== 'full') {
    throw new ForbiddenError('PRIVATE_ACCOUNT', 'This account is private');
  }
  const where: Record<string, unknown> = { followerId: user.id };
  if (opts.cursor) {
    const { createdAt } = decodeCursor(opts.cursor);
    where.createdAt = { lt: createdAt };
  }
  const rows = await prisma.follow.findMany({
    where,
    include: { following: true },
    orderBy: { createdAt: 'desc' },
    take: opts.limit + 1,
  });
  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  return {
    data: page.map((r) => summarizeUser(r.following)),
    nextCursor:
      hasMore && page.length > 0
        ? encodeCursor(page[page.length - 1]!.createdAt, page[page.length - 1]!.followingId)
        : null,
  };
}
