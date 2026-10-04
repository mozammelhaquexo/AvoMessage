/**
 * Manager-scope + admin-guard tests (Backend Engineer B domain):
 *  (b) a manager/owner of company A gets 403 on company B's endpoints;
 *  (c) a normal (non-admin) user gets 403 on every /api/admin/* route.
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
  PATCH as patchCompanyRoute,
  DELETE as deleteCompanyRoute,
} from '@/app/api/companies/[id]/route';
import {
  GET as listCompanyMembersRoute,
  POST as addCompanyMemberRoute,
} from '@/app/api/companies/[id]/members/route';
import {
  PATCH as patchCompanyMemberRoute,
  DELETE as removeCompanyMemberRoute,
} from '@/app/api/companies/[id]/members/[userId]/route';
import { POST as createTeamRoute } from '@/app/api/companies/[id]/teams/route';
import { GET as listInvitationsRoute } from '@/app/api/invitations/route';
import { GET as adminDashboardRoute } from '@/app/api/admin/dashboard/route';
import { GET as adminUsersRoute } from '@/app/api/admin/users/route';
import { GET as adminManagersRoute } from '@/app/api/admin/managers/route';
import { GET as adminCompaniesRoute } from '@/app/api/admin/companies/route';
import { GET as adminPostsRoute } from '@/app/api/admin/posts/route';
import { GET as adminCommentsRoute } from '@/app/api/admin/comments/route';
import { GET as adminReportsRoute } from '@/app/api/admin/reports/route';
import { GET as adminRolesRoute } from '@/app/api/admin/roles/route';
import { GET as adminAuditLogsRoute } from '@/app/api/admin/audit-logs/route';
import { GET as adminAnalyticsRoute } from '@/app/api/admin/analytics/route';
import { GET as adminSettingsRoute } from '@/app/api/admin/settings/route';
import { GET as adminAnnouncementsRoute } from '@/app/api/admin/announcements/route';
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

describe('manager scope: owner of company A cannot touch company B', () => {
  let ownerA: TestAgent;
  let ownerAId: string;
  let ownerB: TestAgent;
  let companyA: string;
  let companyB: string;
  let memberOfB: string;

  beforeAll(async () => {
    ({ agent: ownerA, userId: ownerAId } = await verifiedAgent('scopeA'));
    ({ agent: ownerB } = await verifiedAgent('scopeB'));
    companyA = await createCompany(ownerA, 'Scope Co A');
    companyB = await createCompany(ownerB, 'Scope Co B');
    // A plain member inside company B (for the member-management target).
    const m = await verifiedAgent('scopeBm');
    memberOfB = m.userId;
    const add = await ownerB.callWithParams(
      addCompanyMemberRoute,
      `/api/companies/${companyB}/members`,
      { id: companyB },
      { method: 'POST', body: { userId: memberOfB, role: 'MEMBER' } },
    );
    expect(add.res.status).toBe(201);
  });

  it('owner of A is blocked from company B member management → 403/404', async () => {
    const list = await ownerA.callWithParams(
      listCompanyMembersRoute,
      `/api/companies/${companyB}/members`,
      { id: companyB },
    );
    expect([403, 404]).toContain(list.res.status);

    const add = await ownerA.callWithParams(
      addCompanyMemberRoute,
      `/api/companies/${companyB}/members`,
      { id: companyB },
      { method: 'POST', body: { userId: ownerAId, role: 'MEMBER' } },
    );
    expect([403, 404]).toContain(add.res.status);

    const patch = await ownerA.callWithParams(
      patchCompanyMemberRoute,
      `/api/companies/${companyB}/members/${memberOfB}`,
      { id: companyB, userId: memberOfB },
      { method: 'PATCH', body: { role: 'MANAGER' } },
    );
    expect([403, 404]).toContain(patch.res.status);

    const remove = await ownerA.callWithParams(
      removeCompanyMemberRoute,
      `/api/companies/${companyB}/members/${memberOfB}`,
      { id: companyB, userId: memberOfB },
      { method: 'DELETE' },
    );
    expect([403, 404]).toContain(remove.res.status);
  });

  it('owner of A cannot patch/delete company B or read its invitations → 403/404', async () => {
    const patch = await ownerA.callWithParams(
      patchCompanyRoute,
      `/api/companies/${companyB}`,
      { id: companyB },
      { method: 'PATCH', body: { name: 'Hijacked' } },
    );
    expect([403, 404]).toContain(patch.res.status);

    const del = await ownerA.callWithParams(deleteCompanyRoute, `/api/companies/${companyB}`, {
      id: companyB,
    }, { method: 'DELETE' });
    expect([403, 404]).toContain(del.res.status);

    const team = await ownerA.callWithParams(
      createTeamRoute,
      `/api/companies/${companyB}/teams`,
      { id: companyB },
      { method: 'POST', body: { name: 'Invader Team' } },
    );
    expect([403, 404]).toContain(team.res.status);

    const inv = await ownerA.call(listInvitationsRoute, '/api/invitations');
    expect(inv.res.status).toBe(200);
    // Pending invitations for company B must not be visible to A's owner.
    const rows = (inv.json as Array<{ companyId: string }>) ?? [];
    expect(rows.every((i) => i.companyId !== companyB)).toBe(true);
  });

  it('owner of A CAN manage their own company (positive control)', async () => {
    const list = await ownerA.callWithParams(
      listCompanyMembersRoute,
      `/api/companies/${companyA}/members`,
      { id: companyA },
    );
    expect(list.res.status).toBe(200);

    const patch = await ownerA.callWithParams(
      patchCompanyRoute,
      `/api/companies/${companyA}`,
      { id: companyA },
      { method: 'PATCH', body: { description: 'Updated by owner' } },
    );
    expect(patch.res.status).toBe(200);
  });
});

describe('admin routes: normal user gets 403 on all /api/admin/*', () => {
  let user: TestAgent;

  beforeAll(async () => {
    ({ agent: user } = await verifiedAgent('scopeuser'));
  });

  const adminGets = [
    ['dashboard', adminDashboardRoute, '/api/admin/dashboard'],
    ['users', adminUsersRoute, '/api/admin/users'],
    ['managers', adminManagersRoute, '/api/admin/managers'],
    ['companies', adminCompaniesRoute, '/api/admin/companies'],
    ['posts', adminPostsRoute, '/api/admin/posts'],
    ['comments', adminCommentsRoute, '/api/admin/comments'],
    ['reports', adminReportsRoute, '/api/admin/reports'],
    ['roles', adminRolesRoute, '/api/admin/roles'],
    ['audit-logs', adminAuditLogsRoute, '/api/admin/audit-logs'],
    ['analytics', adminAnalyticsRoute, '/api/admin/analytics'],
    ['settings', adminSettingsRoute, '/api/admin/settings'],
    ['announcements', adminAnnouncementsRoute, '/api/admin/announcements'],
  ] as const;

  for (const [name, handler, path] of adminGets) {
    it(`GET /api/admin/${name} → 403 for non-admin`, async () => {
      const { res } = await user.call(handler, path);
      expect(res.status).toBe(403);
    });
  }

  it('unauthenticated request to /api/admin/dashboard → 401', async () => {
    const anon = agent();
    const { res } = await anon.call(adminDashboardRoute, '/api/admin/dashboard');
    expect(res.status).toBe(401);
  });
});
