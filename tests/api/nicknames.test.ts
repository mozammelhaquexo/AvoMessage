/**
 * The nickname endpoints, and the resolution that reaches the UI.
 *
 * TWO FEATURES, TWO DIFFERENT KINDS OF "PRIVATE", and the difference is the
 * whole point of these tests:
 *
 *   - a CONTACT nickname is private TO THE VIEWER. Only the person who set it
 *     ever sees it, the target is never told, and nothing about the target
 *     changes for anyone else. The failure that matters is a leak: if this
 *     name ever appeared in somebody else's response, the feature would be
 *     quietly broadcasting private labels about people.
 *   - a GROUP nickname is public WITHIN one group and belongs to its owner.
 *     The failure that matters is an authorization one: somebody renaming
 *     another member.
 *
 * The third thing pinned here is that `displayName` — the single resolved field
 * the UI renders — actually reflects those rules through the real
 * `GET /api/conversations/:id` route. Testing the service alone would not catch
 * a serializer that forgot to pass the viewer's nicknames in, which is exactly
 * the kind of gap that makes the header and the conversation list disagree.
 *
 * Requires DATABASE_URL (see tests/setup.ts).
 */
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { signup } from '@/lib/services/auth';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import {
  GET as listConversationsRoute,
  POST as createConversationRoute,
} from '@/app/api/conversations/route';
import { GET as getConversationRoute, PATCH as patchConversationRoute } from '@/app/api/conversations/[id]/route';
import { PUT as putMemberNicknameRoute } from '@/app/api/conversations/[id]/members/[userId]/nickname/route';
import { GET as listNicknamesRoute, PUT as putNicknameRoute } from '@/app/api/nicknames/route';
import { DELETE as deleteNicknameRoute } from '@/app/api/nicknames/[userId]/route';
import { TestAgent, uniqueUser, errCode, type AgentOptions } from '../helpers';

const agents: TestAgent[] = [];
function agent(opts: AgentOptions = {}) {
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

async function openConversation(a: TestAgent, body: Record<string, unknown>) {
  const { res, json } = await a.call(createConversationRoute, '/api/conversations', {
    method: 'POST',
    body,
  });
  expect(res.status).toBe(201);
  return (json as { conversation: { id: string } }).conversation.id;
}

interface MemberShape {
  user: { id: string; name: string };
  nickname: string | null;
  contactNickname: string | null;
  displayName: string;
}

async function readConversation(a: TestAgent, id: string) {
  const { res, json } = await a.callWithParams(getConversationRoute, `/api/conversations/${id}`, {
    id,
  });
  expect(res.status).toBe(200);
  return json as { members: MemberShape[] };
}

function memberIn(convo: { members: MemberShape[] }, userId: string): MemberShape {
  const found = convo.members.find((m) => m.user.id === userId);
  expect(found, `user ${userId} is not a member`).toBeDefined();
  return found!;
}

function setNickname(a: TestAgent, userId: string, nickname: string | null) {
  return a.call(putNicknameRoute, '/api/nicknames', {
    method: 'PUT',
    body: { userId, nickname },
  });
}

function setMemberNickname(a: TestAgent, conversationId: string, userId: string, nickname: string | null) {
  return a.callWithParams(
    putMemberNicknameRoute,
    `/api/conversations/${conversationId}/members/${userId}/nickname`,
    { id: conversationId, userId },
    { method: 'PUT', body: { nickname } },
  );
}

// ─── Contact nicknames (private to the viewer) ──────────────────────────────

describe('contact nicknames', () => {
  it('sets, lists and clears a private name for somebody', async () => {
    const me = await verifiedAgent('nick-me');
    const them = await verifiedAgent('nick-them');

    const set = await setNickname(me.agent, them.user.id, 'Rahim (accounts)');
    expect(set.res.status).toBe(200);

    const listed = await me.agent.call(listNicknamesRoute, '/api/nicknames');
    expect(listed.res.status).toBe(200);
    const rows = (listed.json as { data: { user: { id: string }; nickname: string }[] }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user.id).toBe(them.user.id);
    expect(rows[0]!.nickname).toBe('Rahim (accounts)');

    const cleared = await setNickname(me.agent, them.user.id, null);
    expect(cleared.res.status).toBe(200);

    const after = await me.agent.call(listNicknamesRoute, '/api/nicknames');
    expect((after.json as { data: unknown[] }).data).toHaveLength(0);
  });

  it('is PRIVATE: the target never sees it, and neither does anyone else', async () => {
    const me = await verifiedAgent('priv-me');
    const them = await verifiedAgent('priv-them');
    const bystander = await verifiedAgent('priv-by');

    const dm = await openConversation(me.agent, { type: 'DM', userIds: [them.user.id] });
    expect((await setNickname(me.agent, them.user.id, 'My Private Label')).res.status).toBe(200);

    // The owner sees it.
    const mine = await readConversation(me.agent, dm);
    expect(memberIn(mine, them.user.id).contactNickname).toBe('My Private Label');
    expect(memberIn(mine, them.user.id).displayName).toBe('My Private Label');

    // The target does NOT — not as a contact nickname, and not as a display name.
    const theirs = await readConversation(them.agent, dm);
    expect(memberIn(theirs, them.user.id).contactNickname).toBeNull();
    expect(memberIn(theirs, them.user.id).displayName).toBe(them.user.name);

    // And a third party reading the same conversation sees nothing either.
    await openConversation(bystander.agent, { type: 'GROUP', userIds: [them.user.id], title: 'X' });
    const bystanderList = await bystander.agent.call(listNicknamesRoute, '/api/nicknames');
    expect((bystanderList.json as { data: unknown[] }).data).toHaveLength(0);
  });

  it('shows the private name in the DM the viewer reads', async () => {
    const me = await verifiedAgent('dm-me');
    const them = await verifiedAgent('dm-them');
    const dm = await openConversation(me.agent, { type: 'DM', userIds: [them.user.id] });

    const before = await readConversation(me.agent, dm);
    expect(memberIn(before, them.user.id).displayName).toBe(them.user.name);

    await setNickname(me.agent, them.user.id, 'Bhai');

    const after = await readConversation(me.agent, dm);
    expect(memberIn(after, them.user.id).displayName).toBe('Bhai');
    // The real name is still available, so the UI can show who this really is.
    expect(memberIn(after, them.user.id).user.name).toBe(them.user.name);
  });

  it('refuses to let you nickname yourself', async () => {
    const me = await verifiedAgent('self');
    const { res, json } = await setNickname(me.agent, me.user.id, 'Legend');

    expect(res.status).toBe(400);
    expect(errCode(json)).toBe('VALIDATION_ERROR');
  });

  it('refuses a blank nickname rather than treating it as a clear', async () => {
    const me = await verifiedAgent('blank');
    const them = await verifiedAgent('blank-target');

    // Clearing is an explicit null. Accepting "" would make a mistyped space
    // look like a deliberate reset.
    const { res } = await setNickname(me.agent, them.user.id, '   ');
    expect(res.status).toBe(400);
  });

  it('refuses a nickname longer than the column', async () => {
    const me = await verifiedAgent('long');
    const them = await verifiedAgent('long-target');

    const { res } = await setNickname(me.agent, them.user.id, 'x'.repeat(61));
    expect(res.status).toBe(400);

    const ok = await setNickname(me.agent, them.user.id, 'x'.repeat(60));
    expect(ok.res.status).toBe(200);
  });

  it('404s for a user who does not exist', async () => {
    const me = await verifiedAgent('ghost');
    const { res } = await setNickname(me.agent, 'clzzzzzzzzzzzzzzzzzzzzzzz', 'Nobody');
    expect(res.status).toBe(404);
  });

  it('clears through DELETE, and clearing twice is still a success', async () => {
    const me = await verifiedAgent('del');
    const them = await verifiedAgent('del-target');
    await setNickname(me.agent, them.user.id, 'Gone');

    const first = await me.agent.callWithParams(
      deleteNicknameRoute,
      `/api/nicknames/${them.user.id}`,
      { userId: them.user.id },
      { method: 'DELETE' },
    );
    expect(first.res.status).toBe(200);

    // Idempotent: the caller's intent is already true, so a 404 would only
    // invite a pointless error toast.
    const second = await me.agent.callWithParams(
      deleteNicknameRoute,
      `/api/nicknames/${them.user.id}`,
      { userId: them.user.id },
      { method: 'DELETE' },
    );
    expect(second.res.status).toBe(200);

    const listed = await me.agent.call(listNicknamesRoute, '/api/nicknames');
    expect((listed.json as { data: unknown[] }).data).toHaveLength(0);
  });

  /**
   * The conversation list is POLLED (lib/realtime/polling.ts), so the cost of
   * resolving a nickname per row is a round trip per conversation on every
   * tick. This pins the shape of the fix: one query for the page, whatever the
   * page holds. A regression to a per-conversation lookup would still return
   * the right names — it would just get slower and slower, which no
   * correctness test would ever notice.
   */
  it('resolves a whole conversation list with ONE nickname query', async () => {
    const me = await verifiedAgent('nq-me');
    for (const prefix of ['nq-a', 'nq-b', 'nq-c']) {
      const other = await verifiedAgent(prefix);
      await openConversation(me.agent, { type: 'DM', userIds: [other.user.id] });
      await setNickname(me.agent, other.user.id, `Name for ${prefix}`);
    }

    const spy = vi.spyOn(prisma.contactNickname, 'findMany');
    try {
      const { res, json } = await me.agent.call(listConversationsRoute, '/api/conversations');
      expect(res.status).toBe(200);

      const rows = (json as { data: { members: MemberShape[] }[] }).data;
      expect(rows.length).toBeGreaterThanOrEqual(3);

      // The names still arrive…
      const names = rows.flatMap((c) => c.members.map((m) => m.displayName));
      expect(names).toContain('Name for nq-a');

      // …from a single query.
      expect(spy.mock.calls.length).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('requires a session and a CSRF token', async () => {
    const me = await verifiedAgent('auth');
    const them = await verifiedAgent('auth-target');

    // TWO GATES, AND THE ORDER MATTERS. `handle()` runs the CSRF double-submit
    // check (lib/api.ts step 2) before the handler body, and the session lookup
    // lives inside the handler — so the token gate is the OUTER one. A caller
    // with no cookie jar at all therefore gets 403 CSRF_INVALID, not 401: there
    // is no token to compare, so the request never reaches the session check.
    // Asserting 401 here would pin an order the code does not have.
    const bare = agent();
    const noCookie = await bare.call(putNicknameRoute, '/api/nicknames', {
      method: 'PUT',
      body: { userId: them.user.id, nickname: 'Nope' },
    });
    expect(noCookie.res.status).toBe(403);
    expect(errCode(noCookie.json)).toBe('CSRF_INVALID');

    // With the pair present but no session, the SESSION gate is what refuses —
    // and it must refuse as UNAUTHENTICATED, not as a permission error, so the
    // client knows to send the user to the login screen.
    const csrfOnly = agent({ csrfOnly: true });
    const unauth = await csrfOnly.call(putNicknameRoute, '/api/nicknames', {
      method: 'PUT',
      body: { userId: them.user.id, nickname: 'Nope' },
    });
    expect(unauth.res.status).toBe(401);
    expect(errCode(unauth.json)).toBe('UNAUTHENTICATED');

    // Signed in but missing the header — the classic CSRF attack shape.
    const noCsrf = await me.agent.call(putNicknameRoute, '/api/nicknames', {
      method: 'PUT',
      body: { userId: them.user.id, nickname: 'Nope' },
      csrf: false,
    });
    expect(noCsrf.res.status).toBe(403);
    expect(errCode(noCsrf.json)).toBe('CSRF_INVALID');
  });
});

// ─── Group member nicknames (public within the group, owned by the member) ──

describe('group member nicknames', () => {
  it('lets a member name themselves, and everyone in the group sees it', async () => {
    const owner = await verifiedAgent('g-owner');
    const member = await verifiedAgent('g-member');
    const group = await openConversation(owner.agent, {
      type: 'GROUP',
      userIds: [member.user.id],
      title: 'Design Team',
    });

    const set = await setMemberNickname(member.agent, group, member.user.id, 'Boss');
    expect(set.res.status).toBe(200);

    // Every member sees it, including the owner.
    for (const a of [owner.agent, member.agent]) {
      const convo = await readConversation(a, group);
      expect(memberIn(convo, member.user.id).nickname).toBe('Boss');
      expect(memberIn(convo, member.user.id).displayName).toBe('Boss');
      // The real name survives, so nobody becomes unidentifiable.
      expect(memberIn(convo, member.user.id).user.name).toBe(member.user.name);
    }
  });

  it('clears the nickname back to the real name', async () => {
    const owner = await verifiedAgent('g2-owner');
    const group = await openConversation(owner.agent, { type: 'GROUP', title: 'Solo' });

    await setMemberNickname(owner.agent, group, owner.user.id, 'Chief');
    expect(memberIn(await readConversation(owner.agent, group), owner.user.id).displayName).toBe('Chief');

    const cleared = await setMemberNickname(owner.agent, group, owner.user.id, null);
    expect(cleared.res.status).toBe(200);
    expect(memberIn(await readConversation(owner.agent, group), owner.user.id).displayName).toBe(
      owner.user.name,
    );
  });

  it('REFUSES to let you rename another member', async () => {
    const owner = await verifiedAgent('g3-owner');
    const member = await verifiedAgent('g3-member');
    const group = await openConversation(owner.agent, {
      type: 'GROUP',
      userIds: [member.user.id],
      title: 'Team',
    });

    // Even the group OWNER may not rename somebody else — a nickname belongs to
    // the person it names.
    const { res, json } = await setMemberNickname(owner.agent, group, member.user.id, 'Slacker');
    expect(res.status).toBe(403);
    expect(errCode(json)).toBe('FORBIDDEN');

    const convo = await readConversation(owner.agent, group);
    expect(memberIn(convo, member.user.id).nickname).toBeNull();
  });

  it('refuses a nickname in a DM, where it would silently rename you to the other person', async () => {
    const me = await verifiedAgent('g4-me');
    const them = await verifiedAgent('g4-them');
    const dm = await openConversation(me.agent, { type: 'DM', userIds: [them.user.id] });

    const { res } = await setMemberNickname(me.agent, dm, me.user.id, 'Boss');
    expect(res.status).toBe(400);
  });

  it('refuses a non-member', async () => {
    const owner = await verifiedAgent('g5-owner');
    const outsider = await verifiedAgent('g5-out');
    const group = await openConversation(owner.agent, { type: 'GROUP', title: 'Private' });

    const { res } = await setMemberNickname(outsider.agent, group, outsider.user.id, 'Intruder');
    expect(res.status).toBe(403);
  });

  it("lets the viewer's private rename beat the member's own group nickname", async () => {
    const me = await verifiedAgent('g6-me');
    const them = await verifiedAgent('g6-them');
    const group = await openConversation(me.agent, {
      type: 'GROUP',
      userIds: [them.user.id],
      title: 'Team',
    });

    await setMemberNickname(them.agent, group, them.user.id, 'Boss');
    await setNickname(me.agent, them.user.id, 'Rahim (accounts)');

    // For ME: my private label wins.
    const mine = await readConversation(me.agent, group);
    expect(memberIn(mine, them.user.id).nickname).toBe('Boss');
    expect(memberIn(mine, them.user.id).contactNickname).toBe('Rahim (accounts)');
    expect(memberIn(mine, them.user.id).displayName).toBe('Rahim (accounts)');

    // For THEM: their own group nickname, and my private label is invisible.
    const theirs = await readConversation(them.agent, group);
    expect(memberIn(theirs, them.user.id).displayName).toBe('Boss');
    expect(memberIn(theirs, them.user.id).contactNickname).toBeNull();
  });
});

// ─── Group picture ─────────────────────────────────────────────────────────

describe('group picture', () => {
  it('lets an admin set and remove it, and shows it to every member', async () => {
    const owner = await verifiedAgent('pic-owner');
    const member = await verifiedAgent('pic-member');
    const group = await openConversation(owner.agent, {
      type: 'GROUP',
      userIds: [member.user.id],
      title: 'Team',
    });

    const url = '/uploads/avatar/2026/10/group-photo.webp';
    const set = await owner.agent.callWithParams(
      patchConversationRoute,
      `/api/conversations/${group}`,
      { id: group },
      { method: 'PATCH', body: { avatarUrl: url } },
    );
    expect(set.res.status).toBe(200);
    expect((set.json as { avatarUrl: string | null }).avatarUrl).toBe(url);

    const seen = await member.agent.callWithParams(
      getConversationRoute,
      `/api/conversations/${group}`,
      { id: group },
    );
    expect((seen.json as { avatarUrl: string | null }).avatarUrl).toBe(url);

    const removed = await owner.agent.callWithParams(
      patchConversationRoute,
      `/api/conversations/${group}`,
      { id: group },
      { method: 'PATCH', body: { avatarUrl: null } },
    );
    expect(removed.res.status).toBe(200);
    expect((removed.json as { avatarUrl: string | null }).avatarUrl).toBeNull();
  });

  it('refuses a plain member', async () => {
    const owner = await verifiedAgent('pic2-owner');
    const member = await verifiedAgent('pic2-member');
    const group = await openConversation(owner.agent, {
      type: 'GROUP',
      userIds: [member.user.id],
      title: 'Team',
    });

    const { res } = await member.agent.callWithParams(
      patchConversationRoute,
      `/api/conversations/${group}`,
      { id: group },
      { method: 'PATCH', body: { avatarUrl: '/uploads/avatar/x.png' } },
    );
    expect(res.status).toBe(403);
  });

  it('refuses an outsider', async () => {
    const owner = await verifiedAgent('pic3-owner');
    const outsider = await verifiedAgent('pic3-out');
    const group = await openConversation(owner.agent, { type: 'GROUP', title: 'Team' });

    const { res } = await outsider.agent.callWithParams(
      patchConversationRoute,
      `/api/conversations/${group}`,
      { id: group },
      { method: 'PATCH', body: { avatarUrl: '/uploads/avatar/x.png' } },
    );
    expect(res.status).toBe(403);
  });
});
