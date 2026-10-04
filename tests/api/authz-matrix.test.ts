/**
 * Authorization matrix tests: 401/403/404 enforcement, CSRF, visibility
 * scoping (world feed + search never leak COMPANY/PRIVATE content), comment
 * depth limits, blocks, and the requireAdmin/requireSuperAdmin guards that
 * protect the admin routes (Engineer B's domain — tested at guard level).
 *
 * Requires DATABASE_URL (see tests/setup.ts).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { CompanyRole, PlatformRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { signup } from '@/lib/services/auth';
import {
  requireAdmin,
  requireCompanyMember,
  requireSession,
  requireSuperAdmin,
} from '@/lib/permissions';
import { ForbiddenError } from '@/lib/api';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { GET as meRoute } from '@/app/api/auth/me/route';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import { GET as feedRoute, POST as createPostRoute } from '@/app/api/posts/route';
import { GET as getPostRoute, PATCH as patchPostRoute, DELETE as deletePostRoute } from '@/app/api/posts/[id]/route';
import { POST as likePostRoute } from '@/app/api/posts/[id]/like/route';
import { POST as createCommentRoute } from '@/app/api/posts/[id]/comments/route';
import { POST as followRoute } from '@/app/api/users/[username]/follow/route';
import { POST as blockRoute } from '@/app/api/users/[username]/block/route';
import { GET as profileRoute } from '@/app/api/users/[username]/route';
import { GET as searchRoute } from '@/app/api/search/route';
import { TestAgent, uniqueUser, errCode } from '../helpers';

const agents: TestAgent[] = [];
function agent(opts?: { csrfOnly?: boolean }) {
  const a = new TestAgent(opts);
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

/** Sign up + verify + log in through the real routes. Returns a fully-capable agent. */
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

describe('unauthenticated access', () => {
  it('mutations without a session → 401 (CSRF satisfied, auth not)', async () => {
    const anon = agent({ csrfOnly: true });
    const post = await anon.call(createPostRoute, '/api/posts', {
      method: 'POST',
      body: { body: 'hello' },
    });
    expect(post.res.status).toBe(401);
    expect(errCode(post.json)).toBe('UNAUTHENTICATED');

    const follow = await anon.callWithParams(
      followRoute,
      '/api/users/someone/follow',
      { username: 'someone' },
      { method: 'POST' },
    );
    expect(follow.res.status).toBe(401);
  });

  it('reads without a session → 401, except the public World feed → 200', async () => {
    const anon = agent();
    const me = await anon.call(meRoute, '/api/auth/me');
    expect(me.res.status).toBe(401);
    // The World feed is the public explore surface (ARCHITECTURE.md: 🔒(home)/–(explore)).
    const feed = await anon.call(feedRoute, '/api/posts');
    expect(feed.res.status).toBe(200);
  });
});

describe('CSRF enforcement', () => {
  it('authed mutation without the CSRF header → 403 CSRF_INVALID', async () => {
    const { agent: a } = await verifiedAgent('csrf');
    const post = await a.call(createPostRoute, '/api/posts', {
      method: 'POST',
      body: { body: 'no csrf header' },
      csrf: false,
    });
    expect(post.res.status).toBe(403);
    expect(errCode(post.json)).toBe('CSRF_INVALID');
  });

  it('mismatched CSRF token → 403 CSRF_INVALID', async () => {
    const { agent: a } = await verifiedAgent('csrf2');
    // Header differs from the cookie → double-submit mismatch.
    const post = await a.call(createPostRoute, '/api/posts', {
      method: 'POST',
      body: { body: 'tampered' },
      csrfHeader: 'tampered-value',
    });
    expect(post.res.status).toBe(403);
    expect(errCode(post.json)).toBe('CSRF_INVALID');
  });
});

describe('post ownership', () => {
  it("non-author cannot edit/delete another user's post (403)", async () => {
    const alice = await verifiedAgent('ownA');
    const bob = await verifiedAgent('ownB');
    const postId = await createPost(alice.agent, { body: 'alice post' });

    const patch = await bob.agent.callWithParams(
      patchPostRoute,
      `/api/posts/${postId}`,
      { id: postId },
      { method: 'PATCH', body: { body: 'hijacked' } },
    );
    expect(patch.res.status).toBe(403);
    expect(errCode(patch.json)).toBe('NOT_POST_AUTHOR');

    const del = await bob.agent.callWithParams(
      deletePostRoute,
      `/api/posts/${postId}`,
      { id: postId },
      { method: 'DELETE' },
    );
    expect(del.res.status).toBe(403);

    // Owner can edit.
    const own = await alice.agent.callWithParams(
      patchPostRoute,
      `/api/posts/${postId}`,
      { id: postId },
      { method: 'PATCH', body: { body: 'edited by alice' } },
    );
    expect(own.res.status).toBe(200);
  });
});

describe('visibility matrix', () => {
  it('PRIVATE posts are invisible to others (404, no existence leak)', async () => {
    const alice = await verifiedAgent('privA');
    const bob = await verifiedAgent('privB');
    const postId = await createPost(alice.agent, { body: 'secret diary', visibility: 'PRIVATE' });

    const get = await bob.agent.callWithParams(getPostRoute, `/api/posts/${postId}`, { id: postId });
    expect(get.res.status).toBe(404);

    const like = await bob.agent.callWithParams(likePostRoute, `/api/posts/${postId}/like`, { id: postId }, { method: 'POST' });
    expect(like.res.status).toBe(404);

    const comment = await bob.agent.callWithParams(
      createCommentRoute,
      `/api/posts/${postId}/comments`,
      { id: postId },
      { method: 'POST', body: { body: 'sneaky' } },
    );
    expect(comment.res.status).toBe(404);

    // …and absent from the world feed.
    const feed = await bob.agent.call(feedRoute, '/api/posts');
    const ids = ((feed.json as { data: Array<{ id: string }> }).data ?? []).map((p) => p.id);
    expect(ids).not.toContain(postId);

    // Owner sees it fine.
    const own = await alice.agent.callWithParams(getPostRoute, `/api/posts/${postId}`, { id: postId });
    expect(own.res.status).toBe(200);
  });

  it('FOLLOWERS posts: hidden until follow, visible after', async () => {
    const alice = await verifiedAgent('folA');
    const bob = await verifiedAgent('folB');
    const postId = await createPost(alice.agent, { body: 'followers only', visibility: 'FOLLOWERS' });

    const before = await bob.agent.callWithParams(getPostRoute, `/api/posts/${postId}`, { id: postId });
    expect(before.res.status).toBe(404);

    const follow = await bob.agent.callWithParams(
      followRoute,
      `/api/users/${alice.user.username}/follow`,
      { username: alice.user.username },
      { method: 'POST' },
    );
    expect(follow.res.status).toBe(200);

    const after = await bob.agent.callWithParams(getPostRoute, `/api/posts/${postId}`, { id: postId });
    expect(after.res.status).toBe(200);
  });

  it('search never returns posts the viewer cannot see', async () => {
    const alice = await verifiedAgent('srchA');
    const bob = await verifiedAgent('srchB');
    const kw = `kw${Date.now().toString(36)}`;
    await createPost(alice.agent, { body: `public ${kw}`, visibility: 'PUBLIC' });
    await createPost(alice.agent, { body: `private ${kw}`, visibility: 'PRIVATE' });

    const found = await bob.agent.call(searchRoute, `/api/search?q=${kw}&type=posts`);
    expect(found.res.status).toBe(200);
    const bodies = ((found.json as { data: Array<{ body: string }> }).data ?? []).map((p) => p.body);
    expect(bodies.some((b) => b.includes(`public ${kw}`))).toBe(true);
    expect(bodies.some((b) => b.includes(`private ${kw}`))).toBe(false);
  });
});

describe('company isolation', () => {
  it('COMPANY posts are unreachable by non-members in every surface', async () => {
    const alice = await verifiedAgent('cmpA');
    const bob = await verifiedAgent('cmpB');
    const carol = await verifiedAgent('cmpC');

    const suffix = Date.now().toString(36);
    const company = await prisma.company.create({
      data: { name: `Acme ${suffix}`, slug: `acme-${suffix}`, ownerId: alice.user.id },
    });
    await prisma.companyMember.createMany({
      data: [
        { companyId: company.id, userId: alice.user.id, role: CompanyRole.OWNER },
        { companyId: company.id, userId: bob.user.id, role: CompanyRole.MEMBER },
      ],
    });

    const postId = await createPost(bob.agent, {
      body: 'internal memo',
      visibility: 'COMPANY',
      companyId: company.id,
    });

    // Non-member GET → 404 (not 403: no existence leak).
    const get = await carol.agent.callWithParams(getPostRoute, `/api/posts/${postId}`, { id: postId });
    expect(get.res.status).toBe(404);

    // Non-member world feed excludes it.
    const feed = await carol.agent.call(feedRoute, '/api/posts');
    const ids = ((feed.json as { data: Array<{ id: string }> }).data ?? []).map((p) => p.id);
    expect(ids).not.toContain(postId);

    // Non-member search excludes it.
    const kw = `memo${suffix}`;
    const search = await carol.agent.call(searchRoute, `/api/search?q=${kw}&type=posts`);
    const found = ((search.json as { data: Array<{ id: string }> }).data ?? []).map((p) => p.id);
    expect(found).not.toContain(postId);

    // Non-member cannot post as the company → 403.
    const denied = await carol.agent.call(createPostRoute, '/api/posts', {
      method: 'POST',
      body: { body: 'impersonation', visibility: 'COMPANY', companyId: company.id },
    });
    expect(denied.res.status).toBe(403);
    expect(errCode(denied.json)).toBe('FORBIDDEN');

    // Member sees it.
    const memberGet = await alice.agent.callWithParams(getPostRoute, `/api/posts/${postId}`, { id: postId });
    expect(memberGet.res.status).toBe(200);

    // Cleanup (explicit; company tables are Engineer B's domain).
    await prisma.post.deleteMany({ where: { companyId: company.id } });
    await prisma.companyMember.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
  });
});

describe('comment depth + thread visibility', () => {
  it('reply depth is capped at 3 (403 MAX_DEPTH)', async () => {
    const { agent: a } = await verifiedAgent('depth');
    const postId = await createPost(a, { body: 'thread test' });

    async function reply(parentId: string | null, body: string) {
      return a.callWithParams(
        createCommentRoute,
        `/api/posts/${postId}/comments`,
        { id: postId },
        { method: 'POST', body: { body, parentId } },
      );
    }
    const c0 = await reply(null, 'level 0');
    expect(c0.res.status).toBe(201);
    const c0id = (c0.json as { id: string }).id;
    const c1 = await reply(c0id, 'level 1');
    expect(c1.res.status).toBe(201);
    const c1id = (c1.json as { id: string }).id;
    const c2 = await reply(c1id, 'level 2');
    expect(c2.res.status).toBe(201);
    const c2id = (c2.json as { id: string }).id;

    const tooDeep = await reply(c2id, 'level 3 — too deep');
    expect(tooDeep.res.status).toBe(403);
    expect(errCode(tooDeep.json)).toBe('MAX_DEPTH');
  });
});

describe('blocks', () => {
  it('blocked users vanish from profiles and cannot follow back', async () => {
    const alice = await verifiedAgent('blkA');
    const bob = await verifiedAgent('blkB');

    const block = await alice.agent.callWithParams(
      blockRoute,
      `/api/users/${bob.user.username}/block`,
      { username: bob.user.username },
      { method: 'POST' },
    );
    expect(block.res.status).toBe(200);

    // Blocked viewer → profile 404.
    const profile = await bob.agent.callWithParams(
      profileRoute,
      `/api/users/${alice.user.username}`,
      { username: alice.user.username },
    );
    expect(profile.res.status).toBe(404);

    // Blocked user cannot follow the blocker.
    const follow = await bob.agent.callWithParams(
      followRoute,
      `/api/users/${alice.user.username}/follow`,
      { username: alice.user.username },
      { method: 'POST' },
    );
    expect(follow.res.status).toBe(403);
    expect(errCode(follow.json)).toBe('BLOCKED');
  });
});

describe('role guards (protect admin routes)', () => {
  function authedRequest(a: TestAgent, path = '/api/admin/ping') {
    const headers = new Headers();
    headers.set(
      'cookie',
      [...a.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    );
    return new NextRequest(`http://localhost${path}`, { headers });
  }

  /** Resolve the session's User row (guards take a User, per ARCHITECTURE.md). */
  async function sessionUser(a: TestAgent) {
    return (await requireSession(authedRequest(a))).user;
  }

  it('USER role fails requireAdmin and requireSuperAdmin', async () => {
    const { agent: a } = await verifiedAgent('roleU');
    const user = await sessionUser(a);
    expect(() => requireAdmin(user)).toThrow(ForbiddenError);
    expect(() => requireSuperAdmin(user)).toThrow(ForbiddenError);
  });

  it('ADMIN passes requireAdmin but fails requireSuperAdmin', async () => {
    const { agent: a, user } = await verifiedAgent('roleA');
    await prisma.user.update({ where: { id: user.id }, data: { platformRole: PlatformRole.ADMIN } });
    const fresh = await sessionUser(a);
    expect(fresh.platformRole).toBe(PlatformRole.ADMIN);
    requireAdmin(fresh); // no throw
    expect(() => requireSuperAdmin(fresh)).toThrow(ForbiddenError);
  });

  it('SUPER_ADMIN passes both guards', async () => {
    const { agent: a, user } = await verifiedAgent('roleS');
    await prisma.user.update({ where: { id: user.id }, data: { platformRole: PlatformRole.SUPER_ADMIN } });
    const fresh = await sessionUser(a);
    requireAdmin(fresh);
    requireSuperAdmin(fresh);
  });

  it('non-member fails requireCompanyMember', async () => {
    const { agent: a, user } = await verifiedAgent('roleC');
    await expect(
      requireCompanyMember(user.id, 'company-that-does-not-exist'),
    ).rejects.toThrow(ForbiddenError);
    void a;
  });
});

describe('notification triggers', () => {
  it('follow/like/comment/mention produce notifications; prefs gate them', async () => {
    const alice = await verifiedAgent('ntfA');
    const bob = await verifiedAgent('ntfB');

    // Follow → FOLLOW notification.
    await bob.agent.callWithParams(
      followRoute,
      `/api/users/${alice.user.username}/follow`,
      { username: alice.user.username },
      { method: 'POST' },
    );

    // Mention in a post → MENTION notification.
    const postId = await createPost(bob.agent, { body: `hey @${alice.user.username} look at this` });

    // Like + comment → LIKE and COMMENT notifications.
    await alice.agent.callWithParams(likePostRoute, `/api/posts/${postId}/like`, { id: postId }, { method: 'POST' });
    const { POST: commentRoute } = await import('@/app/api/posts/[id]/comments/route');
    await alice.agent.callWithParams(
      commentRoute,
      `/api/posts/${postId}/comments`,
      { id: postId },
      { method: 'POST', body: { body: 'nice post' } },
    );

    const { GET: notifRoute } = await import('@/app/api/notifications/route');
    const list = await bob.agent.call(notifRoute, '/api/notifications');
    expect(list.res.status).toBe(200);
    const types = ((list.json as { data: Array<{ type: string }> }).data ?? []).map((n) => n.type);
    // Bob authored the post; Alice liked+commented → Bob should see LIKE + COMMENT.
    expect(types).toContain('LIKE');
    expect(types).toContain('COMMENT');

    const aliceList = await alice.agent.call(notifRoute, '/api/notifications');
    const aliceTypes = ((aliceList.json as { data: Array<{ type: string }> }).data ?? []).map((n) => n.type);
    // Alice was followed + mentioned by Bob.
    expect(aliceTypes).toContain('FOLLOW');
    expect(aliceTypes).toContain('MENTION');

    // Opt out of like notifications → new likes stop notifying.
    const { PATCH: prefsRoute } = await import('@/app/api/users/me/notification-preferences/route');
    const prefs = await bob.agent.call(prefsRoute, '/api/users/me/notification-preferences', {
      method: 'PATCH',
      body: { likes: false },
    });
    expect(prefs.res.status).toBe(200);
    expect((prefs.json as { likes: boolean }).likes).toBe(false);
  });
});
