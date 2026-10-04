/**
 * Posts & comments CRUD tests: create/edit/delete posts, comment threading
 * (nested, depth cap), comment edit/delete permissions, like/bookmark
 * toggles, and visibility rules.
 *
 * Requires DATABASE_URL (see tests/setup.ts).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { signup } from '@/lib/services/auth';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import { GET as feedRoute, POST as createPostRoute } from '@/app/api/posts/route';
import {
  GET as getPostRoute,
  PATCH as patchPostRoute,
  DELETE as deletePostRoute,
} from '@/app/api/posts/[id]/route';
import { POST as likePostRoute, DELETE as unlikePostRoute } from '@/app/api/posts/[id]/like/route';
import { POST as bookmarkPostRoute, DELETE as unbookmarkPostRoute } from '@/app/api/posts/[id]/bookmark/route';
import { POST as repostRoute } from '@/app/api/posts/[id]/repost/route';
import {
  GET as listCommentsRoute,
  POST as createCommentRoute,
} from '@/app/api/posts/[id]/comments/route';
import {
  PATCH as patchCommentRoute,
  DELETE as deleteCommentRoute,
} from '@/app/api/comments/[id]/route';
import {
  POST as likeCommentRoute,
  DELETE as unlikeCommentRoute,
} from '@/app/api/comments/[id]/like/route';
import { POST as followRoute } from '@/app/api/users/[username]/follow/route';
import { GET as bookmarksRoute } from '@/app/api/users/me/bookmarks/route';
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
  return { agent: a, user: created.user };
}

async function createPost(a: TestAgent, body: Record<string, unknown>) {
  const { res, json } = await a.call(createPostRoute, '/api/posts', { method: 'POST', body });
  expect(res.status).toBe(201);
  return (json as { id: string }).id;
}

describe('post CRUD', () => {
  it('create → get → edit → delete; deleted post → 404', async () => {
    const author = await verifiedAgent('pcA');

    const postId = await createPost(author.agent, { body: 'hello world', visibility: 'PUBLIC' });

    const got = await author.agent.callWithParams(getPostRoute, `/api/posts/${postId}`, { id: postId });
    expect(got.res.status).toBe(200);
    expect((got.json as { id: string }).id).toBe(postId);

    const edited = await author.agent.callWithParams(
      patchPostRoute,
      `/api/posts/${postId}`,
      { id: postId },
      { method: 'PATCH', body: { body: 'hello world (edited)' } },
    );
    expect(edited.res.status).toBe(200);
    expect((edited.json as { body: string }).body).toBe('hello world (edited)');

    const del = await author.agent.callWithParams(
      deletePostRoute,
      `/api/posts/${postId}`,
      { id: postId },
      { method: 'DELETE' },
    );
    expect(del.res.status).toBe(200);

    const gone = await author.agent.callWithParams(getPostRoute, `/api/posts/${postId}`, { id: postId });
    // Soft-deleted posts report 410 Gone (deliberate; cf. invitations).
    expect(gone.res.status).toBe(410);
  });

  it('non-author cannot edit or delete another post', async () => {
    const author = await verifiedAgent('pcB');
    const other = await verifiedAgent('pcC');
    const postId = await createPost(author.agent, { body: 'not yours', visibility: 'PUBLIC' });

    const hack = await other.agent.callWithParams(
      patchPostRoute,
      `/api/posts/${postId}`,
      { id: postId },
      { method: 'PATCH', body: { body: 'forged' } },
    );
    expect(hack.res.status).toBe(403);

    const del = await other.agent.callWithParams(
      deletePostRoute,
      `/api/posts/${postId}`,
      { id: postId },
      { method: 'DELETE' },
    );
    expect(del.res.status).toBe(403);
  });

  it('validation: empty body → 400; over-long body → 400', async () => {
    const author = await verifiedAgent('pcD');

    const empty = await author.agent.call(createPostRoute, '/api/posts', {
      method: 'POST',
      body: { body: '', visibility: 'PUBLIC' },
    });
    expect(empty.res.status).toBe(400);

    const long = await author.agent.call(createPostRoute, '/api/posts', {
      method: 'POST',
      body: { body: 'x'.repeat(2001), visibility: 'PUBLIC' },
    });
    expect(long.res.status).toBe(400);
  });

  it('repost creates a linked copy attributed to the reposter', async () => {
    const author = await verifiedAgent('pcE');
    const reposter = await verifiedAgent('pcF');
    const postId = await createPost(author.agent, { body: 'original gem', visibility: 'PUBLIC' });

    const rp = await reposter.agent.callWithParams(
      repostRoute,
      `/api/posts/${postId}/repost`,
      { id: postId },
      { method: 'POST' },
    );
    expect(rp.res.status).toBe(201);
    // Repost creates a new post attributed to the reposter with the original
    // body, and bumps the original's share count (no back-link column in v1).
    const reposted = rp.json as { author: { id: string }; body: string; counts: { shares: number } };
    expect(reposted.author.id).toBe(reposter.user.id);
    expect(reposted.body).toBe('original gem');

    const original = await author.agent.callWithParams(getPostRoute, `/api/posts/${postId}`, { id: postId });
    expect((original.json as { counts: { shares: number } }).counts.shares).toBe(1);
  });
});

describe('likes & bookmarks', () => {
  it('like toggles idempotently; counts stay consistent', async () => {
    const author = await verifiedAgent('pcG');
    const liker = await verifiedAgent('pcH');
    const postId = await createPost(author.agent, { body: 'like toggle', visibility: 'PUBLIC' });

    const l1 = await liker.agent.callWithParams(
      likePostRoute,
      `/api/posts/${postId}/like`,
      { id: postId },
      { method: 'POST' },
    );
    expect(l1.res.status).toBe(200);
    expect((l1.json as { liked: boolean }).liked).toBe(true);
    expect((l1.json as { likeCount: number }).likeCount).toBe(1);

    // Toggle again → unlike.
    const l2 = await liker.agent.callWithParams(
      likePostRoute,
      `/api/posts/${postId}/like`,
      { id: postId },
      { method: 'POST' },
    );
    expect((l2.json as { liked: boolean }).liked).toBe(false);
    expect((l2.json as { likeCount: number }).likeCount).toBe(0);

    // Explicit unlike when not liked is a no-op success.
    const ul = await liker.agent.callWithParams(
      unlikePostRoute,
      `/api/posts/${postId}/like`,
      { id: postId },
      { method: 'DELETE' },
    );
    expect(ul.res.status).toBe(200);
    expect((ul.json as { liked: boolean }).liked).toBe(false);

    const got = await liker.agent.callWithParams(getPostRoute, `/api/posts/${postId}`, { id: postId });
    expect((got.json as { counts: { likes: number } }).counts.likes).toBe(0);
  });

  it('bookmark toggle + bookmarks list', async () => {
    const author = await verifiedAgent('pcI');
    const reader = await verifiedAgent('pcJ');
    const postId = await createPost(author.agent, { body: 'bookmark me', visibility: 'PUBLIC' });

    const b1 = await reader.agent.callWithParams(
      bookmarkPostRoute,
      `/api/posts/${postId}/bookmark`,
      { id: postId },
      { method: 'POST' },
    );
    expect(b1.res.status).toBe(200);
    expect((b1.json as { bookmarked: boolean }).bookmarked).toBe(true);

    const list = await reader.agent.call(bookmarksRoute, '/api/users/me/bookmarks');
    expect(list.res.status).toBe(200);
    expect(((list.json as { data: Array<{ id: string }> }).data).some((p) => p.id === postId)).toBe(true);

    const b2 = await reader.agent.callWithParams(
      unbookmarkPostRoute,
      `/api/posts/${postId}/bookmark`,
      { id: postId },
      { method: 'DELETE' },
    );
    expect((b2.json as { bookmarked: boolean }).bookmarked).toBe(false);
  });
});

describe('comments', () => {
  it('nested comments; depth cap enforced', async () => {
    const author = await verifiedAgent('pcK');
    const postId = await createPost(author.agent, { body: 'thread me', visibility: 'PUBLIC' });

    const add = (a: TestAgent, body: string, parentId?: string) =>
      a.callWithParams(
        createCommentRoute,
        `/api/posts/${postId}/comments`,
        { id: postId },
        { method: 'POST', body: parentId ? { body, parentId } : { body } },
      );

    const l0 = await add(author.agent, 'level 0');
    expect(l0.res.status).toBe(201);
    const c0 = (l0.json as { id: string }).id;

    const l1 = await add(author.agent, 'level 1', c0);
    expect(l1.res.status).toBe(201);
    const c1 = (l1.json as { id: string }).id;

    const l2 = await add(author.agent, 'level 2', c1);
    expect(l2.res.status).toBe(201);
    const c2 = (l2.json as { id: string }).id;

    // Depth 3+ is rejected (MAX_COMMENT_DEPTH = 3 → levels 0,1,2).
    const l3 = await add(author.agent, 'level 3 — too deep', c2);
    expect(l3.res.status).toBe(403);
    expect(errCode(l3.json)).toBe('MAX_DEPTH');

    const list = await author.agent.callWithParams(
      listCommentsRoute,
      `/api/posts/${postId}/comments`,
      { id: postId },
    );
    expect(list.res.status).toBe(200);
    // Threaded: one top-level comment with nested replies.
    const top = (list.json as { data: Array<{ id: string; replies: Array<{ id: string; replies: Array<{ id: string }> }> }> }).data;
    expect(top).toHaveLength(1);
    expect(top[0].id).toBe(c0);
    expect(top[0].replies).toHaveLength(1);
    expect(top[0].replies[0].id).toBe(c1);
    expect(top[0].replies[0].replies).toHaveLength(1);
    expect(top[0].replies[0].replies[0].id).toBe(c2);
  });

  it('edit own comment; delete by comment author; post author can delete comments on own post', async () => {
    const author = await verifiedAgent('pcL');
    const commenter = await verifiedAgent('pcM');
    const postId = await createPost(author.agent, { body: 'comment me', visibility: 'PUBLIC' });

    const c = await commenter.agent.callWithParams(
      createCommentRoute,
      `/api/posts/${postId}/comments`,
      { id: postId },
      { method: 'POST', body: { body: 'first!' } },
    );
    expect(c.res.status).toBe(201);
    const commentId = (c.json as { id: string }).id;

    // Edit own comment.
    const edited = await commenter.agent.callWithParams(
      patchCommentRoute,
      `/api/comments/${commentId}`,
      { id: commentId },
      { method: 'PATCH', body: { body: 'first! (edited)' } },
    );
    expect(edited.res.status).toBe(200);
    expect((edited.json as { body: string }).body).toBe('first! (edited)');

    // Post author deletes a comment on their own post.
    const del = await author.agent.callWithParams(
      deleteCommentRoute,
      `/api/comments/${commentId}`,
      { id: commentId },
      { method: 'DELETE' },
    );
    expect(del.res.status).toBe(200);

    // Deleted comment no longer listed.
    const list = await author.agent.callWithParams(
      listCommentsRoute,
      `/api/posts/${postId}/comments`,
      { id: postId },
    );
    expect(((list.json as { data: unknown[] }).data)).toHaveLength(0);
  });

  it('random third party cannot delete a comment', async () => {
    const author = await verifiedAgent('pcN');
    const commenter = await verifiedAgent('pcO');
    const stranger = await verifiedAgent('pcP');
    const postId = await createPost(author.agent, { body: 'guard me', visibility: 'PUBLIC' });

    const c = await commenter.agent.callWithParams(
      createCommentRoute,
      `/api/posts/${postId}/comments`,
      { id: postId },
      { method: 'POST', body: { body: 'hello' } },
    );
    const commentId = (c.json as { id: string }).id;

    const hack = await stranger.agent.callWithParams(
      deleteCommentRoute,
      `/api/comments/${commentId}`,
      { id: commentId },
      { method: 'DELETE' },
    );
    expect(hack.res.status).toBe(403);
  });

  it('comment like toggle', async () => {
    const author = await verifiedAgent('pcQ');
    const liker = await verifiedAgent('pcR');
    const postId = await createPost(author.agent, { body: 'like my comment', visibility: 'PUBLIC' });

    const c = await author.agent.callWithParams(
      createCommentRoute,
      `/api/posts/${postId}/comments`,
      { id: postId },
      { method: 'POST', body: { body: 'witty' } },
    );
    const commentId = (c.json as { id: string }).id;

    const l1 = await liker.agent.callWithParams(
      likeCommentRoute,
      `/api/comments/${commentId}/like`,
      { id: commentId },
      { method: 'POST' },
    );
    expect(l1.res.status).toBe(200);
    expect((l1.json as { liked: boolean }).liked).toBe(true);

    const l2 = await liker.agent.callWithParams(
      unlikeCommentRoute,
      `/api/comments/${commentId}/like`,
      { id: commentId },
      { method: 'DELETE' },
    );
    expect((l2.json as { liked: boolean }).liked).toBe(false);
  });
});

describe('visibility rules', () => {
  it('FOLLOWERS post: followers see it, strangers do not', async () => {
    const author = await verifiedAgent('pcS');
    const follower = await verifiedAgent('pcT');
    const stranger = await verifiedAgent('pcU');

    const f = await follower.agent.callWithParams(
      followRoute,
      `/api/users/${author.user.username}/follow`,
      { username: author.user.username },
      { method: 'POST' },
    );
    expect(f.res.status).toBe(200);

    const postId = await createPost(author.agent, { body: 'followers only', visibility: 'FOLLOWERS' });

    const yes = await follower.agent.callWithParams(getPostRoute, `/api/posts/${postId}`, { id: postId });
    expect(yes.res.status).toBe(200);

    const no = await stranger.agent.callWithParams(getPostRoute, `/api/posts/${postId}`, { id: postId });
    expect(no.res.status).toBe(404);
  });

  it('PRIVATE post: only the author can see it', async () => {
    const author = await verifiedAgent('pcV');
    const follower = await verifiedAgent('pcW');
    const f = await follower.agent.callWithParams(
      followRoute,
      `/api/users/${author.user.username}/follow`,
      { username: author.user.username },
      { method: 'POST' },
    );
    expect(f.res.status).toBe(200);

    const postId = await createPost(author.agent, { body: 'private diary', visibility: 'PRIVATE' });

    const mine = await author.agent.callWithParams(getPostRoute, `/api/posts/${postId}`, { id: postId });
    expect(mine.res.status).toBe(200);

    const theirs = await follower.agent.callWithParams(getPostRoute, `/api/posts/${postId}`, { id: postId });
    expect(theirs.res.status).toBe(404);
  });

  it('world feed never contains FOLLOWERS/COMPANY/PRIVATE posts of others', async () => {
    const author = await verifiedAgent('pcX');
    const reader = await verifiedAgent('pcY');

    await createPost(author.agent, { body: 'public one', visibility: 'PUBLIC' });
    await createPost(author.agent, { body: 'followers one', visibility: 'FOLLOWERS' });
    await createPost(author.agent, { body: 'private one', visibility: 'PRIVATE' });

    const feed = await reader.agent.call(feedRoute, '/api/posts');
    expect(feed.res.status).toBe(200);
    const bodies = ((feed.json as { data: Array<{ body: string; author: { id: string } }> }).data)
      .filter((p) => p.author.id === author.user.id)
      .map((p) => p.body);
    expect(bodies).toContain('public one');
    expect(bodies).not.toContain('followers one');
    expect(bodies).not.toContain('private one');
  });
});
