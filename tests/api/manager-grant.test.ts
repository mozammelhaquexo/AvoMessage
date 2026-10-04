/**
 * Who may create a company manager (part 2, request 3).
 *
 * The rule: a company manager can add MEMBERS. The MANAGER role is granted from
 * the Admin console and only from there. This file drives that rule through the
 * real HTTP routes, and separately through the service, because the two halves
 * are independent guards:
 *
 *   - the service rejects it with 403 `MANAGER_ROLE_ADMIN_ONLY`, on all four
 *     manager-facing paths, AFTER `requireCompanyManager` has run — so an
 *     outsider probing another company's endpoint still gets the 403 they
 *     earned, and a legitimate manager gets a message that says what to do
 *     instead of "expected MEMBER";
 *   - the last test in this block calls `addMember` directly, proving the rule
 *     is not merely a route-level check that a future caller could skip.
 *
 * Then it proves the admin door actually opens: promote, demote, refuse OWNER,
 * and keep the last manager.
 *
 * Requires DATABASE_URL (see tests/setup.ts).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { signup } from '@/lib/services/auth';
import { addMember } from '@/lib/services/companies';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as createCompanyRoute } from '@/app/api/companies/route';
import { POST as addMemberRoute } from '@/app/api/companies/[id]/members/route';
import { PATCH as patchMemberRoute } from '@/app/api/companies/[id]/members/[userId]/route';
import { POST as createAccountRoute } from '@/app/api/companies/[id]/members/create-account/route';
import { POST as inviteRoute } from '@/app/api/invitations/route';
import { PATCH as adminSetRoleRoute } from '@/app/api/admin/managers/[companyId]/members/[userId]/route';
import { TestAgent, uniqueUser, errCode, promoteToManager } from '../helpers';
import type { Actor } from '@/lib/prisma-types';

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

async function verifiedAgent(prefix: string, asAdmin = false) {
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
  if (asAdmin) {
    await prisma.user.update({ where: { id: created.user.id }, data: { platformRole: 'ADMIN' } });
  }
  const login = await a.call(loginRoute, '/api/auth/login', {
    method: 'POST',
    body: { email: u.email, password: u.password },
    csrf: false,
  });
  expect(login.res.status).toBe(200);
  const row = await prisma.user.findUniqueOrThrow({ where: { id: created.user.id } });
  const actor: Actor = {
    id: row.id,
    name: row.name,
    email: row.email,
    platformRole: row.platformRole,
    emailVerifiedAt: row.emailVerifiedAt,
    isActive: row.isActive,
  };
  return { agent: a, user: created.user, actor };
}

async function createCompany(a: TestAgent, name: string) {
  // Only a manager may create a company. The creator becomes its manager —
  // which is the whole premise of this file's "a manager cannot create a
  // manager" rule, so the promotion must not make them a platform admin.
  await promoteToManager(a.userId);
  const { res, json } = await a.call(createCompanyRoute, '/api/companies', { method: 'POST', body: { name } });
  expect(res.status).toBe(201);
  return (json as { company: { id: string } }).company.id;
}

/** A company whose creator is a MANAGER, plus one plain MEMBER to act on. */
async function companyWithManagerAndMember(prefix: string) {
  const manager = await verifiedAgent(`${prefix}Mgr`);
  const member = await verifiedAgent(`${prefix}Mem`);
  const companyId = await createCompany(manager.agent, `Grant Test ${prefix}`);
  const added = await manager.agent.callWithParams(
    addMemberRoute,
    `/api/companies/${companyId}/members`,
    { id: companyId },
    { method: 'POST', body: { userId: member.user.id, role: 'MEMBER' } },
  );
  expect(added.res.status).toBe(201);
  return { manager, member, companyId };
}

describe('a company manager cannot create a manager', () => {
  it('refuses to ADD a member with role MANAGER', async () => {
    const { manager, member, companyId } = await companyWithManagerAndMember('grantAdd');
    const { res, json } = await manager.agent.callWithParams(
      addMemberRoute,
      `/api/companies/${companyId}/members`,
      { id: companyId },
      { method: 'POST', body: { userId: member.user.id, role: 'MANAGER' } },
    );
    expect(res.status).toBe(403);
    expect(errCode(json)).toBe('MANAGER_ROLE_ADMIN_ONLY');
    // Still a plain member — nothing was written.
    const row = await prisma.companyMember.findUniqueOrThrow({
      where: { companyId_userId: { companyId, userId: member.user.id } },
    });
    expect(row.role).toBe('MEMBER');
  });

  it('refuses to PROMOTE an existing member to MANAGER', async () => {
    const { manager, member, companyId } = await companyWithManagerAndMember('grantProm');
    const { res, json } = await manager.agent.callWithParams(
      patchMemberRoute,
      `/api/companies/${companyId}/members/${member.user.id}`,
      { id: companyId, userId: member.user.id },
      { method: 'PATCH', body: { role: 'MANAGER' } },
    );
    expect(res.status).toBe(403);
    expect(errCode(json)).toBe('MANAGER_ROLE_ADMIN_ONLY');
    const row = await prisma.companyMember.findUniqueOrThrow({
      where: { companyId_userId: { companyId, userId: member.user.id } },
    });
    expect(row.role).toBe('MEMBER');
  });

  it('refuses to CREATE an account with role MANAGER', async () => {
    const { manager, companyId } = await companyWithManagerAndMember('grantAcc');
    const u = uniqueUser('grantAccNew');
    const { res, json } = await manager.agent.callWithParams(
      createAccountRoute,
      `/api/companies/${companyId}/members/create-account`,
      { id: companyId },
      { method: 'POST', body: { name: u.name, username: u.username, email: u.email, role: 'MANAGER' } },
    );
    expect(res.status).toBe(403);
    expect(errCode(json)).toBe('MANAGER_ROLE_ADMIN_ONLY');
    // No account was created either — the guard runs before the user insert.
    expect(await prisma.user.findUnique({ where: { email: u.email } })).toBeNull();
  });

  it('refuses to INVITE with role MANAGER', async () => {
    const { manager, companyId } = await companyWithManagerAndMember('grantInv');
    const { res, json } = await manager.agent.call(
      inviteRoute,
      '/api/invitations',
      { method: 'POST', body: { companyId, email: 'nobody@example.com', role: 'MANAGER' } },
    );
    expect(res.status).toBe(403);
    expect(errCode(json)).toBe('MANAGER_ROLE_ADMIN_ONLY');
    expect(
      await prisma.invitation.findFirst({ where: { companyId, email: 'nobody@example.com' } }),
    ).toBeNull();
  });

  it('refuses MANAGER even when the route is bypassed and the service is called directly', async () => {
    const { manager, member, companyId } = await companyWithManagerAndMember('grantSvc');
    // Cast past the narrowed input type: this is the "someone reaches the
    // service without going through the route" case the guard exists for.
    await expect(
      addMember(
        manager.actor,
        companyId,
        { userId: member.user.id, role: 'MANAGER' } as never,
        {},
      ),
    ).rejects.toMatchObject({ status: 403, code: 'MANAGER_ROLE_ADMIN_ONLY' });
  });

  it('still allows a manager to add a plain MEMBER', async () => {
    const { manager, companyId } = await companyWithManagerAndMember('grantOk');
    const extra = await verifiedAgent('grantOkExtra');
    const { res } = await manager.agent.callWithParams(
      addMemberRoute,
      `/api/companies/${companyId}/members`,
      { id: companyId },
      { method: 'POST', body: { userId: extra.user.id, role: 'MEMBER' } },
    );
    expect(res.status).toBe(201);
  });

  it('still allows a manager to DEMOTE a manager back to MEMBER', async () => {
    const { manager, member, companyId } = await companyWithManagerAndMember('grantDem');
    // Promote by hand, the way only the admin console can.
    await prisma.companyMember.update({
      where: { companyId_userId: { companyId, userId: member.user.id } },
      data: { role: 'MANAGER' },
    });
    const { res } = await manager.agent.callWithParams(
      patchMemberRoute,
      `/api/companies/${companyId}/members/${member.user.id}`,
      { id: companyId, userId: member.user.id },
      { method: 'PATCH', body: { role: 'MEMBER' } },
    );
    expect(res.status).toBe(200);
    const row = await prisma.companyMember.findUniqueOrThrow({
      where: { companyId_userId: { companyId, userId: member.user.id } },
    });
    expect(row.role).toBe('MEMBER');
  });
});

describe('the admin console is the one door to the MANAGER role', () => {
  it('lets an admin promote a member, and the company sees a manager', async () => {
    const { member, companyId } = await companyWithManagerAndMember('adminProm');
    const admin = await verifiedAgent('adminPromAdm', true);

    const { res, json } = await admin.agent.callWithParams(
      adminSetRoleRoute,
      `/api/admin/managers/${companyId}/members/${member.user.id}`,
      { companyId, userId: member.user.id },
      { method: 'PATCH', body: { role: 'MANAGER' } },
    );
    expect(res.status).toBe(200);
    expect((json as { member: { role: string } }).member.role).toBe('MANAGER');

    const row = await prisma.companyMember.findUniqueOrThrow({
      where: { companyId_userId: { companyId, userId: member.user.id } },
    });
    expect(row.role).toBe('MANAGER');
  });

  it('refuses a non-admin on the same route', async () => {
    const { manager, member, companyId } = await companyWithManagerAndMember('adminNo');
    const { res, json } = await manager.agent.callWithParams(
      adminSetRoleRoute,
      `/api/admin/managers/${companyId}/members/${member.user.id}`,
      { companyId, userId: member.user.id },
      { method: 'PATCH', body: { role: 'MANAGER' } },
    );
    expect(res.status).toBe(403);
    expect(errCode(json)).toBe('FORBIDDEN');
    const row = await prisma.companyMember.findUniqueOrThrow({
      where: { companyId_userId: { companyId, userId: member.user.id } },
    });
    expect(row.role).toBe('MEMBER');
  });

  it('refuses OWNER from the admin console too', async () => {
    const { member, companyId } = await companyWithManagerAndMember('adminOwn');
    const admin = await verifiedAgent('adminOwnAdm', true);
    const { res, json } = await admin.agent.callWithParams(
      adminSetRoleRoute,
      `/api/admin/managers/${companyId}/members/${member.user.id}`,
      { companyId, userId: member.user.id },
      { method: 'PATCH', body: { role: 'OWNER' } },
    );
    expect(res.status).toBe(400);
    expect(errCode(json)).toBe('VALIDATION_ERROR');
  });

  it('refuses to demote the last manager — a company must stay manageable', async () => {
    const manager = await verifiedAgent('adminLast');
    const companyId = await createCompany(manager.agent, 'Last Manager Co');
    const admin = await verifiedAgent('adminLastAdm', true);

    const { res, json } = await admin.agent.callWithParams(
      adminSetRoleRoute,
      `/api/admin/managers/${companyId}/members/${manager.user.id}`,
      { companyId, userId: manager.user.id },
      { method: 'PATCH', body: { role: 'MEMBER' } },
    );
    expect(res.status).toBe(409);
    expect(errCode(json)).toBe('LAST_MANAGER');
    const row = await prisma.companyMember.findUniqueOrThrow({
      where: { companyId_userId: { companyId, userId: manager.user.id } },
    });
    expect(row.role).toBe('MANAGER');
  });

  it('is idempotent: setting the role someone already has is a 200 no-op', async () => {
    const { member, companyId } = await companyWithManagerAndMember('adminIdem');
    const admin = await verifiedAgent('adminIdemAdm', true);
    const { res, json } = await admin.agent.callWithParams(
      adminSetRoleRoute,
      `/api/admin/managers/${companyId}/members/${member.user.id}`,
      { companyId, userId: member.user.id },
      { method: 'PATCH', body: { role: 'MEMBER' } },
    );
    expect(res.status).toBe(200);
    expect((json as { member: { role: string } }).member.role).toBe('MEMBER');
  });
});
