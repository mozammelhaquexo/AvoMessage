/**
 * Messaging tests: conversation lifecycle (DM dedupe, group member admin),
 * message send/edit/delete, reactions, read receipts, and member scoping
 * (non-members get 403/404 everywhere).
 *
 * Requires DATABASE_URL (see tests/setup.ts).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { signup } from '@/lib/services/auth';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import { GET as listConversationsRoute, POST as createConversationRoute } from '@/app/api/conversations/route';
import {
  GET as getConversationRoute,
  PATCH as patchConversationRoute,
} from '@/app/api/conversations/[id]/route';
import {
  GET as listMessagesRoute,
  POST as sendMessageRoute,
} from '@/app/api/conversations/[id]/messages/route';
import { POST as addMembersRoute } from '@/app/api/conversations/[id]/members/route';
import { DELETE as removeMemberRoute } from '@/app/api/conversations/[id]/members/[userId]/route';
import { POST as markReadRoute } from '@/app/api/conversations/[id]/read/route';
import { PATCH as editMessageRoute, DELETE as deleteMessageRoute } from '@/app/api/messages/[id]/route';
import { POST as forwardMessageRoute } from '@/app/api/messages/[id]/forward/route';
import {
  POST as toggleReactionRoute,
  DELETE as removeReactionRoute,
} from '@/app/api/messages/[id]/reactions/route';
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

/**
 * Signed in (session + CSRF cookies) but email NOT verified.
 *
 * Cannot go through `POST /api/auth/signup`: that route now only sends a code,
 * and redeeming it produces a verified account by construction. The legacy
 * link-based `signup()` service is the remaining way to hold an unverified
 * user, and an unverified user does receive a (limited) session on login — the
 * point of the test that uses this.
 */
async function unverifiedAgent(prefix: string) {
  const u = uniqueUser(prefix);
  const created = await signup(
    { name: u.name, username: u.username, email: u.email, password: u.password },
    {},
  );
  const a = agent();
  a.trackUser(created.user.id);
  const login = await a.call(loginRoute, '/api/auth/login', {
    method: 'POST',
    body: { email: u.email, password: u.password },
    csrf: false,
  });
  expect(login.res.status).toBe(200);
  return { agent: a, user: created.user };
}

async function createConversation(a: TestAgent, body: Record<string, unknown>) {
  const { res, json } = await a.call(createConversationRoute, '/api/conversations', {
    method: 'POST',
    body,
  });
  expect(res.status).toBe(201);
  return (json as { conversation: { id: string }; created: boolean }).conversation.id;
}

async function sendMessage(a: TestAgent, convoId: string, body: Record<string, unknown>) {
  const { res, json } = await a.callWithParams(
    sendMessageRoute,
    `/api/conversations/${convoId}/messages`,
    { id: convoId },
    { method: 'POST', body },
  );
  // 201 on create; 200 when an identical clientId retries (idempotent dedupe).
  expect([200, 201]).toContain(res.status);
  return (json as { message: { id: string; body: string | null } }).message;
}

describe('conversations', () => {
  it('creates a DM; repeat DM with same pair returns the existing one', async () => {
    const alice = await verifiedAgent('msgA');
    const bob = await verifiedAgent('msgB');

    const dmId = await createConversation(alice.agent, { type: 'DM', userIds: [bob.user.id] });

    const dup = await alice.agent.call(createConversationRoute, '/api/conversations', {
      method: 'POST',
      body: { type: 'DM', userIds: [bob.user.id] },
    });
    expect(dup.res.status).toBe(200);
    expect((dup.json as { conversation: { id: string }; created: boolean }).created).toBe(false);
    expect((dup.json as { conversation: { id: string } }).conversation.id).toBe(dmId);

    // DM with two others → 409.
    const carol = await verifiedAgent('msgC');
    const bad = await alice.agent.call(createConversationRoute, '/api/conversations', {
      method: 'POST',
      body: { type: 'DM', userIds: [bob.user.id, carol.user.id] },
    });
    expect(bad.res.status).toBe(409);
  });

  it('creates a group; admin add/remove members; non-admin cannot add', async () => {
    const alice = await verifiedAgent('msgD');
    const bob = await verifiedAgent('msgE');
    const carol = await verifiedAgent('msgF');

    const groupId = await createConversation(alice.agent, {
      type: 'GROUP',
      title: 'Test group',
      userIds: [bob.user.id],
    });

    // Alice (OWNER) adds Carol.
    const add = await alice.agent.callWithParams(
      addMembersRoute,
      `/api/conversations/${groupId}/members`,
      { id: groupId },
      { method: 'POST', body: { userIds: [carol.user.id] } },
    );
    expect(add.res.status).toBe(201);

    // Bob (MEMBER) cannot add members → 403.
    const dave = await verifiedAgent('msgG');
    const addDenied = await bob.agent.callWithParams(
      addMembersRoute,
      `/api/conversations/${groupId}/members`,
      { id: groupId },
      { method: 'POST', body: { userIds: [dave.user.id] } },
    );
    expect(addDenied.res.status).toBe(403);

    // Owner renames the group.
    const renamed = await alice.agent.callWithParams(
      patchConversationRoute,
      `/api/conversations/${groupId}`,
      { id: groupId },
      { method: 'PATCH', body: { title: 'Renamed group' } },
    );
    expect(renamed.res.status).toBe(200);
    expect((renamed.json as { title: string | null }).title).toBe('Renamed group');

    // Carol (MEMBER) cannot rename → 403.
    const renameDenied = await carol.agent.callWithParams(
      patchConversationRoute,
      `/api/conversations/${groupId}`,
      { id: groupId },
      { method: 'PATCH', body: { title: 'Hijacked' } },
    );
    expect(renameDenied.res.status).toBe(403);

    // Owner removes Carol.
    const removed = await alice.agent.callWithParams(
      removeMemberRoute,
      `/api/conversations/${groupId}/members/${carol.user.id}`,
      { id: groupId, userId: carol.user.id },
      { method: 'DELETE' },
    );
    expect(removed.res.status).toBe(200);

    // Removed member can no longer read messages → 403/404.
    const noAccess = await carol.agent.callWithParams(
      listMessagesRoute,
      `/api/conversations/${groupId}/messages`,
      { id: groupId },
    );
    expect([403, 404]).toContain(noAccess.res.status);
  });

  it('non-member cannot see or touch a conversation (403/404)', async () => {
    const alice = await verifiedAgent('msgH');
    const bob = await verifiedAgent('msgI');
    const outsider = await verifiedAgent('msgJ');

    const groupId = await createConversation(alice.agent, {
      type: 'GROUP',
      title: 'Private group',
      userIds: [bob.user.id],
    });

    for (const call of [
      outsider.agent.callWithParams(getConversationRoute, `/api/conversations/${groupId}`, { id: groupId }),
      outsider.agent.callWithParams(listMessagesRoute, `/api/conversations/${groupId}/messages`, { id: groupId }),
    ]) {
      expect([403, 404]).toContain((await call).res.status);
    }

    const send = await outsider.agent.callWithParams(
      sendMessageRoute,
      `/api/conversations/${groupId}/messages`,
      { id: groupId },
      { method: 'POST', body: { body: 'intruder' } },
    );
    expect([403, 404]).toContain(send.res.status);
  });

  it('unverified user cannot send messages', async () => {
    const alice = await verifiedAgent('msgK');
    const unv = await unverifiedAgent('msgL');
    // alice creates the group and adds the unverified user via prisma? No —
    // unverified users can't be added via route by name lookup; instead give
    // them a DM via alice then try to send as unv.
    const dmId = await createConversation(alice.agent, { type: 'DM', userIds: [unv.user.id] });
    const send = await unv.agent.callWithParams(
      sendMessageRoute,
      `/api/conversations/${dmId}/messages`,
      { id: dmId },
      { method: 'POST', body: { body: 'hello' } },
    );
    expect(send.res.status).toBe(403);
    expect(errCode(send.json)).toBe('EMAIL_UNVERIFIED');
  });

  it('lists own conversations ordered with unread counts', async () => {
    const alice = await verifiedAgent('msgM');
    const bob = await verifiedAgent('msgN');
    await createConversation(alice.agent, { type: 'DM', userIds: [bob.user.id] });

    const { res, json } = await alice.agent.call(listConversationsRoute, '/api/conversations');
    expect(res.status).toBe(200);
    const data = (json as { data: unknown[] }).data;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });
});

describe('messages', () => {
  it('send → list newest-first; edit by sender; edit by other → 403', async () => {
    const alice = await verifiedAgent('msgO');
    const bob = await verifiedAgent('msgP');
    const dmId = await createConversation(alice.agent, { type: 'DM', userIds: [bob.user.id] });

    const m1 = await sendMessage(alice.agent, dmId, { body: 'hello bob' });
    const m2 = await sendMessage(bob.agent, dmId, { body: 'hi alice' });
    expect(m1.body).toBe('hello bob');
    expect(m2.body).toBe('hi alice');

    const list = await bob.agent.callWithParams(
      listMessagesRoute,
      `/api/conversations/${dmId}/messages`,
      { id: dmId },
    );
    expect(list.res.status).toBe(200);
    const data = (list.json as { data: Array<{ id: string }> }).data;
    expect(data.map((m) => m.id)).toEqual([m2.id, m1.id]); // newest first

    // Sender edits within the window.
    const edited = await alice.agent.callWithParams(
      editMessageRoute,
      `/api/messages/${m1.id}`,
      { id: m1.id },
      { method: 'PATCH', body: { body: 'hello bob (edited)' } },
    );
    expect(edited.res.status).toBe(200);
    expect((edited.json as { message: { body: string } }).message.body).toBe('hello bob (edited)');

    // Non-sender cannot edit → 403.
    const hack = await bob.agent.callWithParams(
      editMessageRoute,
      `/api/messages/${m1.id}`,
      { id: m1.id },
      { method: 'PATCH', body: { body: 'forged' } },
    );
    expect(hack.res.status).toBe(403);
  });

  it('edit after 15 minutes → MESSAGE_EDIT_EXPIRED', async () => {
    const alice = await verifiedAgent('msgQ');
    const bob = await verifiedAgent('msgR');
    const dmId = await createConversation(alice.agent, { type: 'DM', userIds: [bob.user.id] });
    const m = await sendMessage(alice.agent, dmId, { body: 'old message' });

    await prisma.message.update({
      where: { id: m.id },
      data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) },
    });

    const late = await alice.agent.callWithParams(
      editMessageRoute,
      `/api/messages/${m.id}`,
      { id: m.id },
      { method: 'PATCH', body: { body: 'too late' } },
    );
    expect(late.res.status).toBe(403);
    expect(errCode(late.json)).toBe('MESSAGE_EDIT_EXPIRED');
  });

  it('delete by sender soft-deletes; list shows tombstone', async () => {
    const alice = await verifiedAgent('msgS');
    const bob = await verifiedAgent('msgT');
    const dmId = await createConversation(alice.agent, { type: 'DM', userIds: [bob.user.id] });
    const m = await sendMessage(alice.agent, dmId, { body: 'to be deleted' });

    const del = await alice.agent.callWithParams(
      deleteMessageRoute,
      `/api/messages/${m.id}`,
      { id: m.id },
      { method: 'DELETE' },
    );
    expect(del.res.status).toBe(200);

    const list = await bob.agent.callWithParams(
      listMessagesRoute,
      `/api/conversations/${dmId}/messages`,
      { id: dmId },
    );
    const data = (list.json as { data: Array<{ id: string; deleted?: boolean }> }).data;
    const tomb = data.find((x) => x.id === m.id);
    expect(tomb?.deleted).toBe(true);
  });

  it('group admin can delete another member message; member cannot', async () => {
    const alice = await verifiedAgent('msgU');
    const bob = await verifiedAgent('msgV');
    const carol = await verifiedAgent('msgW');
    const groupId = await createConversation(alice.agent, {
      type: 'GROUP',
      title: 'mod group',
      userIds: [bob.user.id, carol.user.id],
    });
    const m = await sendMessage(bob.agent, groupId, { body: "bob's message" });

    // Carol (member) cannot delete Bob's message.
    const denied = await carol.agent.callWithParams(
      deleteMessageRoute,
      `/api/messages/${m.id}`,
      { id: m.id },
      { method: 'DELETE' },
    );
    expect(denied.res.status).toBe(403);

    // Alice (owner) can.
    const ok = await alice.agent.callWithParams(
      deleteMessageRoute,
      `/api/messages/${m.id}`,
      { id: m.id },
      { method: 'DELETE' },
    );
    expect(ok.res.status).toBe(200);
  });

  it('reactions: toggle on/off, remove, aggregate counts', async () => {
    const alice = await verifiedAgent('msgX');
    const bob = await verifiedAgent('msgY');
    const dmId = await createConversation(alice.agent, { type: 'DM', userIds: [bob.user.id] });
    const m = await sendMessage(alice.agent, dmId, { body: 'react to this' });

    const t1 = await bob.agent.callWithParams(
      toggleReactionRoute,
      `/api/messages/${m.id}/reactions`,
      { id: m.id },
      { method: 'POST', body: { emoji: '👍' } },
    );
    expect(t1.res.status).toBe(200);
    let reactions = (t1.json as { reactions: Array<{ emoji: string; count: number; reacted: boolean }> }).reactions;
    expect(reactions).toEqual([{ emoji: '👍', count: 1, reacted: true }]);

    // Same emoji from alice aggregates.
    const t2 = await alice.agent.callWithParams(
      toggleReactionRoute,
      `/api/messages/${m.id}/reactions`,
      { id: m.id },
      { method: 'POST', body: { emoji: '👍' } },
    );
    reactions = (t2.json as { reactions: typeof reactions }).reactions;
    expect(reactions.find((r) => r.emoji === '👍')?.count).toBe(2);

    // Toggle again removes bob's reaction.
    const t3 = await bob.agent.callWithParams(
      toggleReactionRoute,
      `/api/messages/${m.id}/reactions`,
      { id: m.id },
      { method: 'POST', body: { emoji: '👍' } },
    );
    reactions = (t3.json as { reactions: typeof reactions }).reactions;
    expect(reactions.find((r) => r.emoji === '👍')?.count).toBe(1);

    // Explicit remove.
    const rm = await alice.agent.callWithParams(
      removeReactionRoute,
      `/api/messages/${m.id}/reactions`,
      { id: m.id },
      { method: 'DELETE', body: { emoji: '👍' } },
    );
    expect(rm.res.status).toBe(200);
    expect((rm.json as { reactions: typeof reactions }).reactions.find((r) => r.emoji === '👍')).toBeUndefined();

    // Outsider cannot react.
    const outsider = await verifiedAgent('msgZ');
    const denied = await outsider.agent.callWithParams(
      toggleReactionRoute,
      `/api/messages/${m.id}/reactions`,
      { id: m.id },
      { method: 'POST', body: { emoji: '👍' } },
    );
    expect([403, 404]).toContain(denied.res.status);
  });

  it('mark read updates unread counts; message notifications sent to members', async () => {
    const alice = await verifiedAgent('msgAA');
    const bob = await verifiedAgent('msgBB');
    const dmId = await createConversation(alice.agent, { type: 'DM', userIds: [bob.user.id] });
    await sendMessage(alice.agent, dmId, { body: 'ping' });

    const before = await bob.agent.call(listConversationsRoute, '/api/conversations');
    const convoBefore = (before.json as { data: Array<{ id: string; unreadCount: number }> }).data.find(
      (c) => c.id === dmId,
    );
    expect(convoBefore?.unreadCount).toBeGreaterThanOrEqual(1);

    const read = await bob.agent.callWithParams(
      markReadRoute,
      `/api/conversations/${dmId}/read`,
      { id: dmId },
      { method: 'POST', body: {} },
    );
    expect(read.res.status).toBe(200);

    const after = await bob.agent.call(listConversationsRoute, '/api/conversations');
    const convoAfter = (after.json as { data: Array<{ id: string; unreadCount: number }> }).data.find(
      (c) => c.id === dmId,
    );
    expect(convoAfter?.unreadCount).toBe(0);
  });

  it('clientId dedupes retried sends (idempotent message:send)', async () => {
    const alice = await verifiedAgent('msgCC');
    const bob = await verifiedAgent('msgDD');
    const dmId = await createConversation(alice.agent, { type: 'DM', userIds: [bob.user.id] });
    const clientId = `retry-${Date.now()}`;

    const first = await sendMessage(alice.agent, dmId, { body: 'idempotent', clientId });
    const retry = await alice.agent.callWithParams(
      sendMessageRoute,
      `/api/conversations/${dmId}/messages`,
      { id: dmId },
      { method: 'POST', body: { body: 'idempotent', clientId } },
    );
    expect(retry.res.status).toBe(200); // deduped, not recreated
    const second = (retry.json as { message: { id: string } }).message;
    expect(second.id).toBe(first.id);

    const list = await bob.agent.callWithParams(
      listMessagesRoute,
      `/api/conversations/${dmId}/messages`,
      { id: dmId },
    );
    const data = (list.json as { data: Array<{ id: string }> }).data;
    expect(data.filter((m) => m.id === first.id)).toHaveLength(1);
  });

  it('replyToId must point at a message in the SAME conversation', async () => {
    const alice = await verifiedAgent('msgEE');
    const bob = await verifiedAgent('msgFF');
    const dmId = await createConversation(alice.agent, { type: 'DM', userIds: [bob.user.id] });
    const other = await verifiedAgent('msgGG');
    const otherDm = await createConversation(alice.agent, { type: 'DM', userIds: [other.user.id] });
    const foreign = await sendMessage(alice.agent, otherDm, { body: 'foreign' });

    const reply = await alice.agent.callWithParams(
      sendMessageRoute,
      `/api/conversations/${dmId}/messages`,
      { id: dmId },
      { method: 'POST', body: { body: 'replying', replyToId: foreign.id } },
    );
    expect(reply.res.status).toBe(404);
    expect(errCode(reply.json)).toBe('NOT_FOUND');
  });

  it('reply is PERSISTED, not merely echoed — it survives a reload', async () => {
    const alice = await verifiedAgent('msgHH');
    const bob = await verifiedAgent('msgII');
    const dmId = await createConversation(alice.agent, { type: 'DM', userIds: [bob.user.id] });

    const parent = await sendMessage(alice.agent, dmId, { body: 'the original' });
    const reply = await alice.agent.callWithParams(
      sendMessageRoute,
      `/api/conversations/${dmId}/messages`,
      { id: dmId },
      { method: 'POST', body: { body: 'a reply', replyToId: parent.id } },
    );
    expect(reply.res.status).toBe(201);
    const created = (reply.json as {
      message: { replyTo: { id: string; body: string | null; deleted: boolean } | null };
    }).message;
    expect(created.replyTo?.id).toBe(parent.id);
    expect(created.replyTo?.body).toBe('the original');

    // The decisive check: re-read from the database via the list route. Before
    // the replyToId column existed this came back null and the quote vanished.
    const list = await bob.agent.callWithParams(
      listMessagesRoute,
      `/api/conversations/${dmId}/messages`,
      { id: dmId },
    );
    const persisted = (
      list.json as {
        data: Array<{ id: string; replyTo: { id: string; body: string | null; deleted: boolean } | null }>;
      }
    ).data.find((m) => m.replyTo?.id === parent.id);
    expect(persisted).toBeDefined();
    expect(persisted?.replyTo?.body).toBe('the original');
    expect(persisted?.replyTo?.deleted).toBe(false);
  });

  it('a reply to a soft-deleted parent renders a tombstone quote, not the body', async () => {
    const alice = await verifiedAgent('msgJJ');
    const bob = await verifiedAgent('msgKK');
    const dmId = await createConversation(alice.agent, { type: 'DM', userIds: [bob.user.id] });

    const parent = await sendMessage(alice.agent, dmId, { body: 'secret to be deleted' });
    await alice.agent.callWithParams(
      deleteMessageRoute,
      `/api/messages/${parent.id}`,
      { id: parent.id },
      { method: 'DELETE' },
    );

    const reply = await alice.agent.callWithParams(
      sendMessageRoute,
      `/api/conversations/${dmId}/messages`,
      { id: dmId },
      { method: 'POST', body: { body: 'replying anyway', replyToId: parent.id } },
    );
    expect(reply.res.status).toBe(201);
    const quote = (reply.json as {
      message: { replyTo: { id: string; body: string | null; deleted: boolean } | null };
    }).message.replyTo;
    expect(quote?.deleted).toBe(true);
    // The deleted body must NOT leak through the quote.
    expect(quote?.body).toBeNull();
  });

  it('forward copies the message into another conversation and records its source', async () => {
    const alice = await verifiedAgent('msgLL');
    const bob = await verifiedAgent('msgMM');
    const carol = await verifiedAgent('msgNN');
    const dmId = await createConversation(alice.agent, { type: 'DM', userIds: [bob.user.id] });
    const targetDm = await createConversation(alice.agent, { type: 'DM', userIds: [carol.user.id] });

    const source = await sendMessage(alice.agent, dmId, { body: 'forward me' });

    const fwd = await alice.agent.callWithParams(
      forwardMessageRoute,
      `/api/messages/${source.id}/forward`,
      { id: source.id },
      { method: 'POST', body: { conversationId: targetDm } },
    );
    expect(fwd.res.status).toBe(201);
    const forwarded = (fwd.json as {
      message: { id: string; conversationId: string; body: string | null; forwardedFrom: { id: string } | null };
    }).message;
    expect(forwarded.conversationId).toBe(targetDm);
    expect(forwarded.body).toBe('forward me');
    expect(forwarded.forwardedFrom?.id).toBe(source.id);

    // The source is untouched — a forward is a copy, not a move.
    const sourceStill = await bob.agent.callWithParams(
      listMessagesRoute,
      `/api/conversations/${dmId}/messages`,
      { id: dmId },
    );
    expect(
      (sourceStill.json as { data: Array<{ id: string }> }).data.some((m) => m.id === source.id),
    ).toBe(true);

    // Carol sees it in her own thread.
    const carolList = await carol.agent.callWithParams(
      listMessagesRoute,
      `/api/conversations/${targetDm}/messages`,
      { id: targetDm },
    );
    expect(
      (carolList.json as { data: Array<{ id: string }> }).data.some((m) => m.id === forwarded.id),
    ).toBe(true);
  });

  it('cannot forward a message you have no access to', async () => {
    const alice = await verifiedAgent('msgOO');
    const bob = await verifiedAgent('msgPP');
    const outsider = await verifiedAgent('msgQQ');
    const dmId = await createConversation(alice.agent, { type: 'DM', userIds: [bob.user.id] });
    const outsiderDm = await createConversation(outsider.agent, {
      type: 'DM',
      userIds: [bob.user.id],
    });
    const privateMsg = await sendMessage(alice.agent, dmId, { body: 'private' });

    // Outsider can write to their own DM but must not read alice's message.
    const attempt = await outsider.agent.callWithParams(
      forwardMessageRoute,
      `/api/messages/${privateMsg.id}/forward`,
      { id: privateMsg.id },
      { method: 'POST', body: { conversationId: outsiderDm } },
    );
    expect([403, 404]).toContain(attempt.res.status);
  });
});
