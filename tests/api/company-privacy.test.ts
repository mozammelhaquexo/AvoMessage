/**
 * Company-privacy tests (Backend Engineer B domain): company-private data is
 * NEVER reachable by non-members, on list endpoints AND direct GET by id.
 *
 * Requires DATABASE_URL (see tests/setup.ts).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { signup } from '@/lib/services/auth';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import { POST as createCompanyRoute } from '@/app/api/companies/route';
import {
  GET as getCompanyRoute,
} from '@/app/api/companies/[id]/route';
import {
  GET as listCompanyPostsRoute,
  POST as createCompanyPostRoute,
} from '@/app/api/companies/[id]/posts/route';
import { GET as listCompanyMembersRoute } from '@/app/api/companies/[id]/members/route';
import { GET as companyActivityRoute } from '@/app/api/companies/[id]/activity/route';
import { GET as companyAnnouncementsRoute } from '@/app/api/companies/[id]/announcements/route';
import { POST as createTeamRoute } from '@/app/api/companies/[id]/teams/route';
import { GET as getTeamRoute } from '@/app/api/teams/[id]/route';
import { POST as createConversationRoute } from '@/app/api/conversations/route';
import { GET as getConversationRoute } from '@/app/api/conversations/[id]/route';
import {
  GET as listMessagesRoute,
  POST as sendMessageRoute,
} from '@/app/api/conversations/[id]/messages/route';
import { POST as initiateCallRoute } from '@/app/api/calls/route';
import { GET as getCallRoute } from '@/app/api/calls/[id]/route';
import { GET as callHistoryRoute } from '@/app/api/calls/history/route';
// A's domain — used for the direct-GET-by-id leg of criterion (a).
import { GET as getPostByIdRoute } from '@/app/api/posts/[id]/route';
import { TestAgent, uniqueUser, promoteToManager } from '../helpers';

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

/** Sign up + verify + log in. Returns a fully-capable agent. */
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
  return { agent: a, userId: created.user.id };
}

async function createCompany(a: TestAgent, name: string): Promise<string> {
  // Only a manager may create a company. The creator becomes its manager.
  await promoteToManager(a.userId);
  const { res, json } = await a.call(createCompanyRoute, '/api/companies', {
    method: 'POST',
    body: { name },
  });
  expect(res.status).toBe(201);
  return (json as { company: { id: string } }).company.id;
}

async function createCompanyPost(a: TestAgent, companyId: string): Promise<string> {
  const { res, json } = await a.callWithParams(
    createCompanyPostRoute,
    `/api/companies/${companyId}/posts`,
    { id: companyId },
    { method: 'POST', body: { body: 'Company-private post body' } },
  );
  expect(res.status).toBe(201);
  return (json as { id: string }).id;
}

describe('company privacy', () => {
  let member: TestAgent;
  let memberId: string;
  let outsider: TestAgent;
  let companyId: string;
  let postId: string;

  beforeAll(async () => {
    ({ agent: member, userId: memberId } = await verifiedAgent('privmember'));
    ({ agent: outsider } = await verifiedAgent('privout'));
    companyId = await createCompany(member, 'Private Co');
    postId = await createCompanyPost(member, companyId);
  });

  it('member can read company data (positive control)', async () => {
    const g = await member.callWithParams(getCompanyRoute, `/api/companies/${companyId}`, {
      id: companyId,
    });
    expect(g.res.status).toBe(200);

    const posts = await member.callWithParams(
      listCompanyPostsRoute,
      `/api/companies/${companyId}/posts`,
      { id: companyId },
    );
    expect(posts.res.status).toBe(200);
    expect((posts.json as { data: unknown[] }).data.length).toBeGreaterThan(0);
  });

  it('non-member cannot read the company profile (private data) → 403/404', async () => {
    const { res } = await outsider.callWithParams(
      getCompanyRoute,
      `/api/companies/${companyId}`,
      { id: companyId },
    );
    expect([403, 404]).toContain(res.status);
  });

  it('non-member cannot list or post to the company feed → 403/404', async () => {
    const list = await outsider.callWithParams(
      listCompanyPostsRoute,
      `/api/companies/${companyId}/posts`,
      { id: companyId },
    );
    expect([403, 404]).toContain(list.res.status);

    const create = await outsider.callWithParams(
      createCompanyPostRoute,
      `/api/companies/${companyId}/posts`,
      { id: companyId },
      { method: 'POST', body: { body: 'Sneaky post' } },
    );
    expect([403, 404]).toContain(create.res.status);
  });

  it('non-member cannot reach a company post by direct id GET → 403/404', async () => {
    const { res } = await outsider.callWithParams(
      getPostByIdRoute,
      `/api/posts/${postId}`,
      { id: postId },
    );
    expect([403, 404]).toContain(res.status);
  });

  it('member CAN reach the same post by direct id GET', async () => {
    const { res } = await member.callWithParams(getPostByIdRoute, `/api/posts/${postId}`, {
      id: postId,
    });
    expect(res.status).toBe(200);
  });

  it('non-member cannot read members, activity, or announcements → 403/404', async () => {
    const members = await outsider.callWithParams(
      listCompanyMembersRoute,
      `/api/companies/${companyId}/members`,
      { id: companyId },
    );
    expect([403, 404]).toContain(members.res.status);

    const activity = await outsider.callWithParams(
      companyActivityRoute,
      `/api/companies/${companyId}/activity`,
      { id: companyId },
    );
    expect([403, 404]).toContain(activity.res.status);

    const announcements = await outsider.callWithParams(
      companyAnnouncementsRoute,
      `/api/companies/${companyId}/announcements`,
      { id: companyId },
    );
    expect([403, 404]).toContain(announcements.res.status);
  });

  it('non-member cannot read a team inside the company → 403/404', async () => {
    const { res: createRes, json } = await member.callWithParams(
      createTeamRoute,
      `/api/companies/${companyId}/teams`,
      { id: companyId },
      { method: 'POST', body: { name: 'Secret Team' } },
    );
    expect(createRes.status).toBe(201);
    const teamId = (json as { id: string }).id;

    const { res } = await outsider.callWithParams(getTeamRoute, `/api/teams/${teamId}`, {
      id: teamId,
    });
    expect([403, 404]).toContain(res.status);
  });

  it('non-member cannot read conversations/messages they are not in → 403/404', async () => {
    // DM between member and outsider — a THIRD user is the true outsider.
    const third = await verifiedAgent('privthird');
    const { res: cRes, json: cJson } = await third.agent.call(createConversationRoute, '/api/conversations', {
      method: 'POST',
      body: { type: 'DM', userIds: [memberId] },
    });
    expect(cRes.status).toBe(201);
    const convoId = (cJson as { conversation: { id: string } }).conversation.id;

    const g = await outsider.callWithParams(getConversationRoute, `/api/conversations/${convoId}`, {
      id: convoId,
    });
    expect([403, 404]).toContain(g.res.status);

    const m = await outsider.callWithParams(
      listMessagesRoute,
      `/api/conversations/${convoId}/messages`,
      { id: convoId },
    );
    expect([403, 404]).toContain(m.res.status);

    const s = await outsider.callWithParams(
      sendMessageRoute,
      `/api/conversations/${convoId}/messages`,
      { id: convoId },
      { method: 'POST', body: { body: 'intruder' } },
    );
    expect([403, 404]).toContain(s.res.status);
  });

  it('call metadata is only visible to participants', async () => {
    const third = await verifiedAgent('privcaller');
    const { res: cRes, json: cJson } = await third.agent.call(initiateCallRoute, '/api/calls', {
      method: 'POST',
      body: { userIds: [memberId], type: 'AUDIO' },
    });
    expect(cRes.status).toBe(201);
    const callId = (cJson as { call: { id: string } }).call.id;

    // Participant can read it.
    const p = await member.callWithParams(getCallRoute, `/api/calls/${callId}`, { id: callId });
    expect(p.res.status).toBe(200);

    // Non-participant cannot.
    const o = await outsider.callWithParams(getCallRoute, `/api/calls/${callId}`, { id: callId });
    expect([403, 404]).toContain(o.res.status);

    // Non-participant's history never contains it (strict filtering, not erroring).
    const h = await outsider.call(callHistoryRoute, '/api/calls/history');
    expect(h.res.status).toBe(200);
    const ids = ((h.json as { data: Array<{ id: string }> }).data ?? []).map((c) => c.id);
    expect(ids).not.toContain(callId);
  });
});
