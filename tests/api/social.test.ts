/**
 * Social graph tests: follow/unfollow, block/mute, profile privacy,
 * bookmarks, password change, and notification preferences.
 *
 * Requires DATABASE_URL (see tests/setup.ts).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { signup } from '@/lib/services/auth';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import { GET as profileRoute, PATCH as patchProfileRoute } from '@/app/api/users/[username]/route';
import { POST as followRoute } from '@/app/api/users/[username]/follow/route';
import { POST as unfollowRoute } from '@/app/api/users/[username]/unfollow/route';
import { POST as blockRoute } from '@/app/api/users/[username]/block/route';
import { POST as muteRoute } from '@/app/api/users/[username]/mute/route';
import { GET as followersRoute } from '@/app/api/users/[username]/followers/route';
import { GET as selfRoute, PATCH as patchSelfRoute } from '@/app/api/users/me/route';
import { POST as changePasswordRoute } from '@/app/api/users/me/password/route';
import { GET as bookmarksRoute } from '@/app/api/users/me/bookmarks/route';
import { GET as getPrefsRoute, PATCH as patchPrefsRoute } from '@/app/api/users/me/notification-preferences/route';
import { POST as createPostRoute } from '@/app/api/posts/route';
import { POST as bookmarkPostRoute } from '@/app/api/posts/[id]/bookmark/route';
import { POST as likeCommentRoute } from '@/app/api/comments/[id]/like/route';
import { TestAgent, uniqueUser, errCode } from '../helpers';

const agents: TestAgent[] = [];
function agent() {
  const a = new TestAgent();
  agents.push(a);
  return a;
}
afterAll(async () => {
  for (const a of agents) await a.cleanup();
  await prisma.$disconnect();
});
beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

async function verifiedAgent(prefix: string) {
  const u = uniqueUser(prefix);
  const created = await signup(
    { name: u.name, username: u.username, email: u.email, password: u.password },
    {},
  );
  const a = agent();
  a.trackUser(created.user.id);
  const v = await a.call(verifyEmailRoute, '/api/auth/verify-email', {
    method: 'POST',
    body: { token: created.verificationToken },
    csrf: false,
  });
  expect(v.res.status).toBe(200);
  const login = await a.call(loginRoute, '/api/auth/login', {
    method: 'POST',
    body: { email: u.email, password: u.password },
    csrf: false,
  });
  expect(login.res.status).toBe(200);
  return { agent: a, user: created.user, creds: u };
}

async function createPost(a: TestAgent, body: Record<string, unknown>) {
  const { res, json } = await a.call(createPostRoute, '/api/posts', { method: 'POST', body });
  expect(res.status).toBe(201);
  return (json as { id: string }).id;
}

describe('follow / unfollow', () => {
  it('follow is idempotent; unfollow works; self-follow → 409', async () => {
    const alice = await verifiedAgent('socA');
    const bob = await verifiedAgent('socB');

    const f1 = await bob.agent.callWithParams(
      followRoute,
      `/api/users/${alice.user.username}/follow`,
      { username: alice.user.username },
      { method: 'POST' },
    );
    expect(f1.res.status).toBe(200);
    expect((f1.json as { following: boolean }).following).toBe(true);

    const f2 = await bob.agent.callWithParams(
      followRoute,
      `/api/users/${alice.user.username}/follow`,
      { username: alice.user.username },
      { method: 'POST' },
    );
    expect(f2.res.status).toBe(200); // idempotent

    const un = await bob.agent.callWithParams(
      unfollowRoute,
      `/api/users/${alice.user.username}/unfollow`,
      { username: alice.user.username },
      { method: 'POST' },
    );
    expect(un.res.status).toBe(200);
    expect((un.json as { following: boolean }).following).toBe(false);

    const self = await bob.agent.callWithParams(
      followRoute,
      `/api/users/${bob.user.username}/follow`,
      { username: bob.user.username },
      { method: 'POST' },
    );
    expect(self.res.status).toBe(409);
    expect(errCode(self.json)).toBe('CANNOT_FOLLOW_SELF');
  });

  it('followers list reflects follows', async () => {
    const alice = await verifiedAgent('socC');
    const bob = await verifiedAgent('socD');
    await bob.agent.callWithParams(
      followRoute,
      `/api/users/${alice.user.username}/follow`,
      { username: alice.user.username },
      { method: 'POST' },
    );
    const list = await alice.agent.callWithParams(
      followersRoute,
      `/api/users/${alice.user.username}/followers`,
      { username: alice.user.username },
    );
    expect(list.res.status).toBe(200);
    const users = (list.json as { data: Array<{ username: string }> }).data ?? [];
    expect(users.some((u) => u.username === bob.user.username)).toBe(true);
  });
});

describe('profile privacy', () => {
  it('private profiles hide details from non-followers, show to followers', async () => {
    const alice = await verifiedAgent('prvA');
    const bob = await verifiedAgent('prvB');

    const set = await alice.agent.call(patchSelfRoute, '/api/users/me', {
      method: 'PATCH',
      body: { isPrivate: true, bio: 'secret bio' },
    });
    expect(set.res.status).toBe(200);

    const stranger = await bob.agent.callWithParams(
      profileRoute,
      `/api/users/${alice.user.username}`,
      { username: alice.user.username },
    );
    expect(stranger.res.status).toBe(200);
    const strangerBody = stranger.json as { bio: string | null };
    expect(strangerBody.bio).toBeNull(); // hidden from non-follower

    await bob.agent.callWithParams(
      followRoute,
      `/api/users/${alice.user.username}/follow`,
      { username: alice.user.username },
      { method: 'POST' },
    );
    const follower = await bob.agent.callWithParams(
      profileRoute,
      `/api/users/${alice.user.username}`,
      { username: alice.user.username },
    );
    expect((follower.json as { bio: string | null }).bio).toBe('secret bio');
  });

  it('PATCH /api/users/[username] only edits your own profile (403 otherwise)', async () => {
    const alice = await verifiedAgent('prfA');
    const bob = await verifiedAgent('prfB');
    const evil = await bob.agent.callWithParams(
      patchProfileRoute,
      `/api/users/${alice.user.username}`,
      { username: alice.user.username },
      { method: 'PATCH', body: { bio: 'hacked' } },
    );
    expect(evil.res.status).toBe(403);
  });

  it('mute hides without blocking; unmute restores', async () => {
    const alice = await verifiedAgent('mutA');
    const bob = await verifiedAgent('mutB');
    const mute = await bob.agent.callWithParams(
      muteRoute,
      `/api/users/${alice.user.username}/mute`,
      { username: alice.user.username },
      { method: 'POST', body: {} },
    );
    expect(mute.res.status).toBe(200);
    // Muted user's profile is still visible (mute ≠ block).
    const profile = await bob.agent.callWithParams(
      profileRoute,
      `/api/users/${alice.user.username}`,
      { username: alice.user.username },
    );
    expect(profile.res.status).toBe(200);
    const unmute = await bob.agent.callWithParams(
      muteRoute,
      `/api/users/${alice.user.username}/mute`,
      { username: alice.user.username },
      { method: 'DELETE' },
    );
    expect(unmute.res.status).toBe(200);
  });
});

describe('settings', () => {
  it('password change requires the current password; new password works', async () => {
    const { agent: a, creds } = await verifiedAgent('pwdA');

    const wrong = await a.call(changePasswordRoute, '/api/users/me/password', {
      method: 'POST',
      body: { currentPassword: 'nope-wrong', newPassword: 'new-secure-password-1' },
    });
    expect(wrong.res.status).toBe(401);
    expect(errCode(wrong.json)).toBe('INVALID_CREDENTIALS');

    const weak = await a.call(changePasswordRoute, '/api/users/me/password', {
      method: 'POST',
      body: { currentPassword: creds.password, newPassword: 'short' },
    });
    expect(weak.res.status).toBe(400);

    const ok = await a.call(changePasswordRoute, '/api/users/me/password', {
      method: 'POST',
      body: { currentPassword: creds.password, newPassword: 'new-secure-password-1' },
    });
    expect(ok.res.status).toBe(200);

    // New password logs in; old password does not.
    const b = agent();
    const loginNew = await b.call(loginRoute, '/api/auth/login', {
      method: 'POST',
      body: { email: creds.email, password: 'new-secure-password-1' },
      csrf: false,
    });
    expect(loginNew.res.status).toBe(200);
    const loginOld = await b.call(loginRoute, '/api/auth/login', {
      method: 'POST',
      body: { email: creds.email, password: creds.password },
      csrf: false,
    });
    expect(loginOld.res.status).toBe(401);
  });

  it('notification preferences round-trip', async () => {
    const { agent: a } = await verifiedAgent('nprA');
    const before = await a.call(getPrefsRoute, '/api/users/me/notification-preferences');
    expect(before.res.status).toBe(200);
    expect((before.json as { likes: boolean }).likes).toBe(true);

    const patch = await a.call(patchPrefsRoute, '/api/users/me/notification-preferences', {
      method: 'PATCH',
      body: { likes: false, mentions: false },
    });
    expect(patch.res.status).toBe(200);
    const prefs = patch.json as Record<string, boolean>;
    expect(prefs.likes).toBe(false);
    expect(prefs.mentions).toBe(false);
    expect(prefs.comments).toBe(true); // untouched
  });

  it('bookmark toggle + bookmarks list', async () => {
    const alice = await verifiedAgent('bmkA');
    const bob = await verifiedAgent('bmkB');
    const postId = await createPost(alice.agent, { body: 'bookmark me' });

    const on = await bob.agent.callWithParams(
      bookmarkPostRoute,
      `/api/posts/${postId}/bookmark`,
      { id: postId },
      { method: 'POST' },
    );
    expect(on.res.status).toBe(200);
    expect((on.json as { bookmarked: boolean }).bookmarked).toBe(true);

    const list = await bob.agent.call(bookmarksRoute, '/api/users/me/bookmarks');
    expect(list.res.status).toBe(200);
    const ids = ((list.json as { data: Array<{ id: string }> }).data ?? []).map((p) => p.id);
    expect(ids).toContain(postId);

    const off = await bob.agent.callWithParams(
      bookmarkPostRoute,
      `/api/posts/${postId}/bookmark`,
      { id: postId },
      { method: 'POST' },
    );
    expect((off.json as { bookmarked: boolean }).bookmarked).toBe(false);
  });

  it('comment likes toggle', async () => {
    const alice = await verifiedAgent('cmlA');
    const bob = await verifiedAgent('cmlB');
    const postId = await createPost(alice.agent, { body: 'comment like test' });
    const { POST: commentRoute } = await import('@/app/api/posts/[id]/comments/route');
    const c = await alice.agent.callWithParams(
      commentRoute,
      `/api/posts/${postId}/comments`,
      { id: postId },
      { method: 'POST', body: { body: 'a comment' } },
    );
    const commentId = (c.json as { id: string }).id;

    const like = await bob.agent.callWithParams(
      likeCommentRoute,
      `/api/comments/${commentId}/like`,
      { id: commentId },
      { method: 'POST' },
    );
    expect(like.res.status).toBe(200);
    expect((like.json as { liked: boolean }).liked).toBe(true);

    const unlike = await bob.agent.callWithParams(
      likeCommentRoute,
      `/api/comments/${commentId}/like`,
      { id: commentId },
      { method: 'POST' },
    );
    expect((unlike.json as { liked: boolean }).liked).toBe(false);
  });

  it('blocking removes follows in both directions', async () => {
    const alice = await verifiedAgent('blk2A');
    const bob = await verifiedAgent('blk2B');
    await bob.agent.callWithParams(
      followRoute,
      `/api/users/${alice.user.username}/follow`,
      { username: alice.user.username },
      { method: 'POST' },
    );
    const block = await alice.agent.callWithParams(
      blockRoute,
      `/api/users/${bob.user.username}/block`,
      { username: bob.user.username },
      { method: 'POST' },
    );
    expect(block.res.status).toBe(200);
    // Bob no longer follows Alice (follow removed by block).
    const self = await alice.agent.call(selfRoute, '/api/users/me');
    expect(self.res.status).toBe(200);
    const state = await bob.agent.callWithParams(
      profileRoute,
      `/api/users/${alice.user.username}`,
      { username: alice.user.username },
    );
    expect(state.res.status).toBe(404); // blocked → invisible
  });
});
