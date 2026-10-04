/**
 * Notification tests: creation on like/comment/follow/mention, preference
 * filtering, block suppression, mark-read (one / subset / all), and the
 * unreadCount contract.
 *
 * Requires DATABASE_URL (see tests/setup.ts).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { signup } from '@/lib/services/auth';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import { POST as createPostRoute } from '@/app/api/posts/route';
import { POST as likePostRoute } from '@/app/api/posts/[id]/like/route';
import { POST as createCommentRoute } from '@/app/api/posts/[id]/comments/route';
import { POST as followRoute } from '@/app/api/users/[username]/follow/route';
import { POST as blockRoute } from '@/app/api/users/[username]/block/route';
import { GET as notificationsRoute } from '@/app/api/notifications/route';
import { POST as markAllReadRoute } from '@/app/api/notifications/read/route';
import { POST as markOneReadRoute } from '@/app/api/notifications/[id]/read/route';
import { TestAgent, uniqueUser } from '../helpers';

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

interface NotificationItem {
  id: string;
  type: string;
  actor: { id: string; name: string; username: string; avatarUrl: string | null } | null;
  readAt: string | null;
}

async function notifications(a: TestAgent, unreadOnly = false) {
  const path = unreadOnly ? '/api/notifications?unreadOnly=true' : '/api/notifications';
  const { res, json } = await a.call(notificationsRoute, path);
  expect(res.status).toBe(200);
  return json as { data: NotificationItem[]; unreadCount: number; nextCursor: string | null };
}

describe('notification creation', () => {
  it('like creates a LIKE notification for the post author', async () => {
    const author = await verifiedAgent('ntA');
    const liker = await verifiedAgent('ntB');
    const postId = await createPost(author.agent, { body: 'like me', visibility: 'PUBLIC' });

    const like = await liker.agent.callWithParams(
      likePostRoute,
      `/api/posts/${postId}/like`,
      { id: postId },
      { method: 'POST' },
    );
    expect(like.res.status).toBe(200);

    const list = await notifications(author.agent);
    expect(list.unreadCount).toBeGreaterThanOrEqual(1);
    expect(list.data.some((n) => n.type === 'LIKE' && n.actor?.id === liker.user.id)).toBe(true);
  });

  it('comment creates a COMMENT notification for the post author', async () => {
    const author = await verifiedAgent('ntC');
    const commenter = await verifiedAgent('ntD');
    const postId = await createPost(author.agent, { body: 'comment on me', visibility: 'PUBLIC' });

    const c = await commenter.agent.callWithParams(
      createCommentRoute,
      `/api/posts/${postId}/comments`,
      { id: postId },
      { method: 'POST', body: { body: 'nice post!' } },
    );
    expect(c.res.status).toBe(201);

    const list = await notifications(author.agent);
    expect(list.data.some((n) => n.type === 'COMMENT' && n.actor?.id === commenter.user.id)).toBe(true);
  });

  it('follow creates a FOLLOW notification', async () => {
    const alice = await verifiedAgent('ntE');
    const bob = await verifiedAgent('ntF');

    const f = await bob.agent.callWithParams(
      followRoute,
      `/api/users/${alice.user.username}/follow`,
      { username: alice.user.username },
      { method: 'POST' },
    );
    expect(f.res.status).toBe(200);

    const list = await notifications(alice.agent);
    expect(list.data.some((n) => n.type === 'FOLLOW' && n.actor?.id === bob.user.id)).toBe(true);
  });

  it('@mention in a post creates a MENTION notification', async () => {
    const author = await verifiedAgent('ntG');
    const mentioned = await verifiedAgent('ntH');

    await createPost(author.agent, {
      body: `hey @${mentioned.user.username} check this out`,
      visibility: 'PUBLIC',
    });

    const list = await notifications(mentioned.agent);
    expect(
      list.data.some((n) => n.type === 'MENTION' && n.actor?.id === author.user.id),
    ).toBe(true);
  });

  it('no self-notification when liking your own post', async () => {
    const author = await verifiedAgent('ntI');
    const postId = await createPost(author.agent, { body: 'self love', visibility: 'PUBLIC' });

    const like = await author.agent.callWithParams(
      likePostRoute,
      `/api/posts/${postId}/like`,
      { id: postId },
      { method: 'POST' },
    );
    expect(like.res.status).toBe(200);

    const list = await notifications(author.agent, true);
    expect(list.data.some((n) => n.type === 'LIKE')).toBe(false);
  });

  it('blocked actor does not create a notification for the blocker', async () => {
    const author = await verifiedAgent('ntJ');
    const troll = await verifiedAgent('ntK');
    const postId = await createPost(author.agent, { body: 'troll bait', visibility: 'PUBLIC' });

    // author blocks troll; troll still can like (service-level check is on
    // notification creation, not the like itself).
    const b = await author.agent.callWithParams(
      blockRoute,
      `/api/users/${troll.user.username}/block`,
      { username: troll.user.username },
      { method: 'POST' },
    );
    expect(b.res.status).toBe(200);

    const like = await troll.agent.callWithParams(
      likePostRoute,
      `/api/posts/${postId}/like`,
      { id: postId },
      { method: 'POST' },
    );
    expect(like.res.status).toBe(200);

    const list = await notifications(author.agent, true);
    expect(list.data.some((n) => n.type === 'LIKE' && n.actor?.id === troll.user.id)).toBe(false);
  });
});

describe('mark-read', () => {
  it('mark one → mark subset → mark all; unreadCount tracks correctly', async () => {
    const author = await verifiedAgent('ntL');
    const a1 = await verifiedAgent('ntM');
    const a2 = await verifiedAgent('ntN');
    const postId = await createPost(author.agent, { body: 'notify storm', visibility: 'PUBLIC' });

    for (const liker of [a1, a2]) {
      const r = await liker.agent.callWithParams(
        likePostRoute,
        `/api/posts/${postId}/like`,
        { id: postId },
        { method: 'POST' },
      );
      expect(r.res.status).toBe(200);
    }
    const f = await a1.agent.callWithParams(
      followRoute,
      `/api/users/${author.user.username}/follow`,
      { username: author.user.username },
      { method: 'POST' },
    );
    expect(f.res.status).toBe(200);

    const before = await notifications(author.agent);
    expect(before.unreadCount).toBeGreaterThanOrEqual(3);

    // Mark one.
    const first = before.data[0];
    const one = await author.agent.callWithParams(
      markOneReadRoute,
      `/api/notifications/${first.id}/read`,
      { id: first.id },
      { method: 'POST' },
    );
    expect(one.res.status).toBe(200);
    const afterOne = await notifications(author.agent);
    expect(afterOne.unreadCount).toBe(before.unreadCount - 1);

    // Mark a subset of ids (pick a still-unread one).
    const unreadTarget = afterOne.data.find((n) => !n.readAt);
    expect(unreadTarget).toBeTruthy();
    const subset = await author.agent.call(markAllReadRoute, '/api/notifications/read', {
      method: 'POST',
      body: { ids: [unreadTarget!.id] },
    });
    expect(subset.res.status).toBe(200);
    expect((subset.json as { marked: number }).marked).toBe(1);

    // Mark all (empty body).
    const all = await author.agent.call(markAllReadRoute, '/api/notifications/read', {
      method: 'POST',
      body: {},
    });
    expect(all.res.status).toBe(200);
    const afterAllRead = await notifications(author.agent, true);
    expect(afterAllRead.unreadCount).toBe(0);
    expect(afterAllRead.data).toHaveLength(0);
  });

  it('cannot mark another user\'s notification as read', async () => {
    const author = await verifiedAgent('ntO');
    const liker = await verifiedAgent('ntP');
    const snooper = await verifiedAgent('ntQ');
    const postId = await createPost(author.agent, { body: 'mine only', visibility: 'PUBLIC' });

    const like = await liker.agent.callWithParams(
      likePostRoute,
      `/api/posts/${postId}/like`,
      { id: postId },
      { method: 'POST' },
    );
    expect(like.res.status).toBe(200);

    const list = await notifications(author.agent);
    const target = list.data.find((n) => n.actor?.id === liker.user.id);
    expect(target).toBeTruthy();

    const hack = await snooper.agent.callWithParams(
      markOneReadRoute,
      `/api/notifications/${target!.id}/read`,
      { id: target!.id },
      { method: 'POST' },
    );
    expect(hack.res.status).toBe(404);
  });

  it('unreadOnly filter returns only unread', async () => {
    const author = await verifiedAgent('ntR');
    const liker = await verifiedAgent('ntS');
    const postId = await createPost(author.agent, { body: 'filter me', visibility: 'PUBLIC' });

    const like = await liker.agent.callWithParams(
      likePostRoute,
      `/api/posts/${postId}/like`,
      { id: postId },
      { method: 'POST' },
    );
    expect(like.res.status).toBe(200);

    const unread = await notifications(author.agent, true);
    expect(unread.data.length).toBeGreaterThanOrEqual(1);

    await author.agent.call(markAllReadRoute, '/api/notifications/read', {
      method: 'POST',
      body: {},
    });
    const unreadAfter = await notifications(author.agent, true);
    expect(unreadAfter.data).toHaveLength(0);
    // Full list still shows read notifications.
    const full = await notifications(author.agent, false);
    expect(full.data.length).toBeGreaterThanOrEqual(1);
  });
});
