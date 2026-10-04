/**
 * Manager applications (feature 10).
 *
 * The rules that matter, in the order they can go wrong:
 *   - a user cannot submit two applications at once;
 *   - a normal user cannot list, read or review anyone's application;
 *   - approval does NOT need a company — a manager creates their own (request 4);
 *   - approval grants the role when a company is attached, and the status and
 *     the role agree afterwards;
 *   - the OWNER role can never be granted, by any path (request 7);
 *   - a decided application cannot be decided twice.
 *
 * Requires DATABASE_URL (see tests/setup.ts).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { signup } from '@/lib/services/auth';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as createCompanyRoute } from '@/app/api/companies/route';
import {
  GET as getMineRoute,
  POST as submitRoute,
} from '@/app/api/manager-applications/route';
import { DELETE as withdrawRoute } from '@/app/api/manager-applications/[id]/route';
import { GET as adminListRoute } from '@/app/api/admin/manager-applications/route';
import {
  GET as adminDetailRoute,
  POST as adminReviewRoute,
} from '@/app/api/admin/manager-applications/[id]/route';
import { TestAgent, uniqueUser, errCode, promoteToManager } from '../helpers';

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
    // Promoted directly: the platform has no "create an admin" endpoint.
    await prisma.user.update({
      where: { id: created.user.id },
      data: { platformRole: 'ADMIN' },
    });
  }
  const login = await a.call(loginRoute, '/api/auth/login', {
    method: 'POST',
    body: { email: u.email, password: u.password },
    csrf: false,
  });
  expect(login.res.status).toBe(200);
  return { agent: a, user: created.user };
}

async function createCompany(a: TestAgent, name: string) {
  // Only a manager may create a company (request: no user can). The creator
  // becomes its manager. Note this writes an APPROVED application for the
  // creator — which is exactly how the platform records "this person is a
  // manager", and why it is never the applicant in the tests below.
  await promoteToManager(a.userId);
  const { res, json } = await a.call(createCompanyRoute, '/api/companies', {
    method: 'POST',
    body: { name },
  });
  expect(res.status).toBe(201);
  return (json as { company: { id: string } }).company.id;
}

const APPLICATION = {
  companyName: 'Acme Corp',
  position: 'Head of Ops',
  companySize: 120,
  teamCount: 3,
  teamSize: 8,
  message: 'I have run this team for three years.',
};

async function submit(a: TestAgent, body: Record<string, unknown> = APPLICATION) {
  return a.call(submitRoute, '/api/manager-applications', { method: 'POST', body });
}

describe('manager applications — applicant', () => {
  it('submits, reads back, and refuses a second PENDING application', async () => {
    const applicant = await verifiedAgent('mgrAppA');

    const created = await submit(applicant.agent);
    expect(created.res.status).toBe(201);
    const app = (created.json as { id: string; status: string; position: string });
    expect(app.status).toBe('PENDING');
    expect(app.position).toBe('Head of Ops');

    const mine = await applicant.agent.call(getMineRoute, '/api/manager-applications');
    expect(mine.res.status).toBe(200);
    expect((mine.json as { id: string }).id).toBe(app.id);

    // A second application while one is pending is a conflict, not a duplicate.
    const dup = await submit(applicant.agent);
    expect(dup.res.status).toBe(409);
    expect(errCode(dup.json)).toBe('APPLICATION_PENDING');
  });

  it('withdraws a PENDING application, and cannot withdraw it twice', async () => {
    const applicant = await verifiedAgent('mgrAppB');
    const created = await submit(applicant.agent);
    const id = (created.json as { id: string }).id;

    const wd = await applicant.agent.callWithParams(
      withdrawRoute,
      `/api/manager-applications/${id}`,
      { id },
      { method: 'DELETE' },
    );
    expect(wd.res.status).toBe(200);
    expect((wd.json as { status: string }).status).toBe('WITHDRAWN');

    const again = await applicant.agent.callWithParams(
      withdrawRoute,
      `/api/manager-applications/${id}`,
      { id },
      { method: 'DELETE' },
    );
    expect(again.res.status).toBe(409);
    expect(errCode(again.json)).toBe('ALREADY_REVIEWED');

    // Withdrawn is not pending, so a fresh application is allowed.
    const fresh = await submit(applicant.agent);
    expect(fresh.res.status).toBe(201);
  });

  it('cannot withdraw somebody else’s application', async () => {
    const owner = await verifiedAgent('mgrAppC');
    const attacker = await verifiedAgent('mgrAppD');
    const created = await submit(owner.agent);
    const id = (created.json as { id: string }).id;

    const attempt = await attacker.agent.callWithParams(
      withdrawRoute,
      `/api/manager-applications/${id}`,
      { id },
      { method: 'DELETE' },
    );
    expect(attempt.res.status).toBe(403);
  });
});

describe('manager applications — authorization', () => {
  it('a normal user gets 403 on every admin application route', async () => {
    const user = await verifiedAgent('mgrAppE');
    const other = await verifiedAgent('mgrAppE2');
    const created = await submit(user.agent);
    const id = (created.json as { id: string }).id;
    const otherApp = (await submit(other.agent)).json as { id: string };

    const list = await user.agent.call(adminListRoute, '/api/admin/manager-applications');
    expect(list.res.status).toBe(403);

    // Note: a user MAY read their OWN application (Settings shows the decision
    // note). The guard is that they cannot read anyone else's.
    const own = await user.agent.callWithParams(
      adminDetailRoute,
      `/api/admin/manager-applications/${id}`,
      { id },
    );
    expect(own.res.status).toBe(200);

    const someoneElse = await user.agent.callWithParams(
      adminDetailRoute,
      `/api/admin/manager-applications/${otherApp.id}`,
      { id: otherApp.id },
    );
    expect(someoneElse.res.status).toBe(403);

    const review = await user.agent.callWithParams(
      adminReviewRoute,
      `/api/admin/manager-applications/${id}`,
      { id },
      { method: 'POST', body: { action: 'APPROVE' } },
    );
    expect(review.res.status).toBe(403);
  });

  it('an applicant can read their own detail but not a stranger’s', async () => {
    const alice = await verifiedAgent('mgrAppF');
    const bob = await verifiedAgent('mgrAppG');
    const aliceApp = (await submit(alice.agent)).json as { id: string };
    const bobApp = (await submit(bob.agent)).json as { id: string };

    const own = await alice.agent.callWithParams(
      adminDetailRoute,
      `/api/admin/manager-applications/${aliceApp.id}`,
      { id: aliceApp.id },
    );
    expect(own.res.status).toBe(200);

    const other = await alice.agent.callWithParams(
      adminDetailRoute,
      `/api/admin/manager-applications/${bobApp.id}`,
      { id: bobApp.id },
    );
    expect(other.res.status).toBe(403);
  });
});

describe('manager applications — review', () => {
  it('approves WITHOUT a company — the manager creates their own company', async () => {
    const applicant = await verifiedAgent('mgrAppH');
    const admin = await verifiedAgent('mgrAppI', true);
    const app = (await submit(applicant.agent)).json as { id: string };

    // The admin no longer picks a company (request 4): the applicant named a
    // company that does not exist, and approval still succeeds.
    const approve = await admin.agent.callWithParams(
      adminReviewRoute,
      `/api/admin/manager-applications/${app.id}`,
      { id: app.id },
      { method: 'POST', body: { action: 'APPROVE' } },
    );
    expect(approve.res.status).toBe(200);
    const decided = approve.json as { status: string; companyId: string | null };
    expect(decided.status).toBe('APPROVED');
    expect(decided.companyId).toBeNull();

    // No company role is granted — there is no company to grant it in.
    const memberships = await prisma.companyMember.findMany({
      where: { userId: applicant.user.id },
    });
    expect(memberships).toHaveLength(0);

    const mine = await applicant.agent.call(getMineRoute, '/api/manager-applications');
    expect((mine.json as { status: string }).status).toBe('APPROVED');
  });

  it('refuses to grant the owner role, by any path', async () => {
    const applicant = await verifiedAgent('mgrAppH2');
    const admin = await verifiedAgent('mgrAppI2', true);
    const app = (await submit(applicant.agent)).json as { id: string };

    const approve = await admin.agent.callWithParams(
      adminReviewRoute,
      `/api/admin/manager-applications/${app.id}`,
      { id: app.id },
      { method: 'POST', body: { action: 'APPROVE', role: 'OWNER' } },
    );
    expect(approve.res.status).toBe(400);
    expect(errCode(approve.json)).toBe('VALIDATION_ERROR');

    // Still pending — a rejected decision must not consume the application.
    const mine = await applicant.agent.call(getMineRoute, '/api/manager-applications');
    expect((mine.json as { status: string }).status).toBe('PENDING');
  });

  it('approving grants the company role, and the status and role agree', async () => {
    const applicant = await verifiedAgent('mgrAppJ');
    const owner = await verifiedAgent('mgrAppK');
    const admin = await verifiedAgent('mgrAppL', true);
    const companyId = await createCompany(owner.agent, `Grant Target ${Date.now().toString(36)}`);

    const app = (await submit(applicant.agent)).json as { id: string };

    const approve = await admin.agent.callWithParams(
      adminReviewRoute,
      `/api/admin/manager-applications/${app.id}`,
      { id: app.id },
      { method: 'POST', body: { action: 'APPROVE', companyId, role: 'MANAGER', note: 'Welcome aboard.' } },
    );
    expect(approve.res.status).toBe(200);
    const decided = approve.json as {
      status: string;
      reviewNote: string | null;
      company: { id: string } | null;
    };
    expect(decided.status).toBe('APPROVED');
    expect(decided.reviewNote).toBe('Welcome aboard.');
    expect(decided.company?.id).toBe(companyId);

    // The role is what makes the Manager Panel appear in the sidebar.
    const membership = await prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId: applicant.user.id } },
    });
    expect(membership?.role).toBe('MANAGER');

    // Deciding twice is refused.
    const again = await admin.agent.callWithParams(
      adminReviewRoute,
      `/api/admin/manager-applications/${app.id}`,
      { id: app.id },
      { method: 'POST', body: { action: 'DECLINE' } },
    );
    expect(again.res.status).toBe(409);
    expect(errCode(again.json)).toBe('ALREADY_REVIEWED');
  });

  it('approving never DEMOTES a legacy owner', async () => {
    const owner = await verifiedAgent('mgrAppM');
    const admin = await verifiedAgent('mgrAppN', true);
    const companyId = await createCompany(owner.agent, `No Demote ${Date.now().toString(36)}`);

    // A company created under the current rules makes its creator a MANAGER.
    // Promote this one to OWNER by hand to reproduce a legacy row, then check
    // that approval cannot walk it back down.
    await prisma.companyMember.update({
      where: { companyId_userId: { companyId, userId: owner.user.id } },
      data: { role: 'OWNER' },
    });

    // The owner applies to their own company.
    const app = (
      await submit(owner.agent, { ...APPLICATION, companyName: 'Anything' })
    ).json as { id: string };

    const approve = await admin.agent.callWithParams(
      adminReviewRoute,
      `/api/admin/manager-applications/${app.id}`,
      { id: app.id },
      { method: 'POST', body: { action: 'APPROVE', companyId, role: 'MANAGER' } },
    );
    expect(approve.res.status).toBe(200);

    const membership = await prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId: owner.user.id } },
    });
    expect(membership?.role).toBe('OWNER');
  });

  it('admin list filters by status', async () => {
    const applicant = await verifiedAgent('mgrAppO');
    const admin = await verifiedAgent('mgrAppP', true);
    const app = (await submit(applicant.agent)).json as { id: string };

    const pending = await admin.agent.call(
      adminListRoute,
      '/api/admin/manager-applications?status=PENDING',
    );
    expect(pending.res.status).toBe(200);
    const pendingIds = (pending.json as { data: Array<{ id: string }> }).data.map((r) => r.id);
    expect(pendingIds).toContain(app.id);

    // Declined, then it must drop out of the PENDING filter…
    await admin.agent.callWithParams(
      adminReviewRoute,
      `/api/admin/manager-applications/${app.id}`,
      { id: app.id },
      { method: 'POST', body: { action: 'DECLINE', note: 'Not this time.' } },
    );

    const stillPending = await admin.agent.call(
      adminListRoute,
      '/api/admin/manager-applications?status=PENDING',
    );
    const pendingAfter = (stillPending.json as { data: Array<{ id: string }> }).data.map((r) => r.id);
    expect(pendingAfter).not.toContain(app.id);

    // …and appear under DECLINED instead.
    const declined = await admin.agent.call(
      adminListRoute,
      '/api/admin/manager-applications?status=DECLINED',
    );
    const declinedIds = (declined.json as { data: Array<{ id: string }> }).data.map((r) => r.id);
    expect(declinedIds).toContain(app.id);
  });
});
