/**
 * Server-side authorization helpers (docs/RBAC.md §3). SERVER-SIDE ONLY —
 * never import from client components.
 *
 * Every helper throws typed errors mapped to HTTP codes by lib/api.ts:
 *   UnauthenticatedError (401), ForbiddenError (403),
 *   EmailUnverifiedError (403 EMAIL_UNVERIFIED), SuspendedError (403 ACCOUNT_SUSPENDED).
 *
 * Call order in route handlers: requireSession → requireVerified (writes) →
 * scope helper (requireCompanyMember / requireConversationMember / ...) →
 * service. Services re-assert ownership on loaded rows (defense in depth).
 *
 * NOTE: `canViewPost` is async (it needs follow/membership lookups) — RBAC.md
 * sketches it sync, but a sync version cannot enforce FOLLOWERS/COMPANY
 * visibility. The async signature is the documented correction.
 */
import type { NextRequest } from 'next/server';
import type { CompanyMember, Session, User } from '@prisma/client';
import { CompanyRole, ConversationRole, PlatformRole, PostVisibility, TeamRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  EmailUnverifiedError,
  ForbiddenError,
  SuspendedError,
  UnauthenticatedError,
} from '@/lib/api';
import { getSessionFromRequest } from '@/lib/auth/session';

// Re-exported so callers can import errors from one place.
export { EmailUnverifiedError, ForbiddenError, SuspendedError, UnauthenticatedError };

// ─── Session / identity ─────────────────────────────────────────────────────

export interface AuthContext {
  user: User;
  session: Session;
}

/**
 * Verifies the signed session cookie → session row → not revoked/expired →
 * user active. Refreshes sliding expiry (debounced). Used by every 🔒 route.
 */
export async function requireSession(req: NextRequest): Promise<AuthContext> {
  const found = await getSessionFromRequest(req);
  if (!found) throw new UnauthenticatedError();
  if (!found.user.isActive) throw new SuspendedError();
  return found;
}

/** Throws EmailUnverifiedError (403) when the user has not verified their email. */
export function requireVerified(user: User): void {
  if (!user.emailVerifiedAt) throw new EmailUnverifiedError();
}

// ─── Platform roles ─────────────────────────────────────────────────────────

const PLATFORM_RANK: Record<PlatformRole, number> = {
  [PlatformRole.USER]: 0,
  [PlatformRole.ADMIN]: 1,
  [PlatformRole.SUPER_ADMIN]: 2,
};

/** Platform hierarchy check: SUPER_ADMIN > ADMIN > USER. */
export function requireRole(user: User, min: PlatformRole): void {
  if (PLATFORM_RANK[user.platformRole] < PLATFORM_RANK[min]) {
    throw new ForbiddenError();
  }
}

export function requireAdmin(user: User): void {
  requireRole(user, PlatformRole.ADMIN);
}

export function requireSuperAdmin(user: User): void {
  if (user.platformRole !== PlatformRole.SUPER_ADMIN) throw new ForbiddenError();
}

// ─── Company scope ───────────────────────────────────────────────────────────

const COMPANY_RANK: Record<CompanyRole, number> = {
  [CompanyRole.MEMBER]: 0,
  [CompanyRole.MANAGER]: 1,
  [CompanyRole.OWNER]: 2,
};

/**
 * Throws Forbidden when the user has no membership or their role is below
 * `min`. Returns the membership row for downstream use.
 */
export async function requireCompanyMember(
  userId: string,
  companyId: string,
  min: CompanyRole = CompanyRole.MEMBER,
): Promise<CompanyMember> {
  const membership = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId } },
  });
  if (!membership || COMPANY_RANK[membership.role] < COMPANY_RANK[min]) {
    throw new ForbiddenError('FORBIDDEN', 'Company membership required');
  }
  return membership;
}

export function requireCompanyManager(userId: string, companyId: string) {
  return requireCompanyMember(userId, companyId, CompanyRole.MANAGER);
}

export function requireCompanyOwner(userId: string, companyId: string) {
  return requireCompanyMember(userId, companyId, CompanyRole.OWNER);
}

/** Non-throwing membership lookup (for visibility checks). */
export async function getCompanyMembership(
  userId: string,
  companyId: string,
): Promise<CompanyMember | null> {
  return prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId } },
  });
}

// ─── Conversation / team scope ──────────────────────────────────────────────

const CONVERSATION_RANK: Record<ConversationRole, number> = {
  [ConversationRole.MEMBER]: 0,
  [ConversationRole.ADMIN]: 1,
  [ConversationRole.OWNER]: 2,
};

export async function requireConversationMember(
  userId: string,
  conversationId: string,
  min: ConversationRole = ConversationRole.MEMBER,
) {
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!membership || CONVERSATION_RANK[membership.role] < CONVERSATION_RANK[min]) {
    throw new ForbiddenError('FORBIDDEN', 'Conversation membership required');
  }
  return membership;
}

const TEAM_RANK: Record<TeamRole, number> = {
  [TeamRole.MEMBER]: 0,
  [TeamRole.MANAGER]: 1,
};

export async function requireTeamMember(
  userId: string,
  teamId: string,
  min: TeamRole = TeamRole.MEMBER,
) {
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (!membership || TEAM_RANK[membership.role] < TEAM_RANK[min]) {
    throw new ForbiddenError('FORBIDDEN', 'Team membership required');
  }
  return membership;
}

// ─── Social graph helpers ───────────────────────────────────────────────────

export async function isFollowing(followerId: string, followingId: string): Promise<boolean> {
  const row = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId, followingId } },
  });
  return !!row;
}

/** True when either user blocked the other. Blocks DMs, mentions, notifications. */
export async function isBlockedEitherWay(aId: string, bId: string): Promise<boolean> {
  if (aId === bId) return false;
  const row = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: aId, blockedId: bId },
        { blockerId: bId, blockedId: aId },
      ],
    },
  });
  return !!row;
}

export async function isMuted(muterId: string, mutedId: string): Promise<boolean> {
  const row = await prisma.mute.findUnique({
    where: { muterId_mutedId: { muterId, mutedId } },
  });
  return !!row;
}

// ─── Content visibility ─────────────────────────────────────────────────────

export interface PostVisibilityCheck {
  id: string;
  authorId: string;
  visibility: PostVisibility;
  companyId: string | null;
  deletedAt: Date | null;
}

/**
 * Whether `viewer` (null when anonymous) may see the post.
 * PUBLIC: anyone · FOLLOWERS: followers + author · COMPANY: company members ·
 * PRIVATE: author only. Suspended/deleted authors are never visible.
 */
export async function canViewPost(
  viewer: Pick<User, 'id'> | null,
  post: PostVisibilityCheck,
): Promise<boolean> {
  if (post.deletedAt) return false;
  switch (post.visibility) {
    case PostVisibility.PUBLIC:
      return true;
    case PostVisibility.PRIVATE:
      return viewer?.id === post.authorId;
    case PostVisibility.FOLLOWERS:
      if (!viewer) return false;
      if (viewer.id === post.authorId) return true;
      return isFollowing(viewer.id, post.authorId);
    case PostVisibility.COMPANY: {
      if (!viewer || !post.companyId) return false;
      if (viewer.id === post.authorId) return true;
      return (await getCompanyMembership(viewer.id, post.companyId)) !== null;
    }
    default:
      return false;
  }
}

/** Company content (feed, members, teams) requires membership — never public. */
export async function canViewCompanyContent(
  viewerId: string | null,
  companyId: string,
): Promise<boolean> {
  if (!viewerId) return false;
  return (await getCompanyMembership(viewerId, companyId)) !== null;
}

export type ProfileVisibility = 'full' | 'limited' | 'none';

export interface ProfileVisibilityCheck {
  id: string;
  isPrivate: boolean;
}

/**
 * 'full' → bio, counts, posts. 'limited' → name/username/avatar only.
 * 'none' → blocked either way (callers should 404).
 */
export async function canViewProfile(
  viewer: Pick<User, 'id'> | null,
  profile: ProfileVisibilityCheck,
): Promise<ProfileVisibility> {
  if (viewer && (await isBlockedEitherWay(viewer.id, profile.id))) return 'none';
  if (!viewer) return profile.isPrivate ? 'limited' : 'full';
  if (viewer.id === profile.id) return 'full';
  if (!profile.isPrivate) return 'full';
  return (await isFollowing(viewer.id, profile.id)) ? 'full' : 'limited';
}
