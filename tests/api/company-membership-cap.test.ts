/**
 * The create gate and the membership caps, driven through the real HTTP routes
 * (request: "no user can create a company — only a manager can; a user may be
 * in one company, a manager three, an admin as many as they like").
 *
 * The pure rule is covered in tests/company-membership-policy.test.ts. What is
 * only provable here is that the rule is actually *reached*: that
 * `POST /api/companies` consults it, that the count it consults is the real
 * one, and that the refusal is the code the client branches on.
 *
 * Three things this file deliberately pins beyond the happy path:
 *
 *   1. The cap binds the person being ADDED, not the manager doing the adding.
 *      A manager with room must not be able to push somebody past their own
 *      limit.
 *   2. An approved manager who has no company yet can still create one. The
 *      approval notification tells them to; if the gate refused, the one
 *      instruction the platform gives them would be the one thing they are
 *      forbidden to do.
 *   3. Being an approved manager raises the ceiling to three, not to infinity.
 *
 * Requires DATABASE_URL (see tests/setup.ts).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { signup } from '@/lib/services/auth';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as createCompanyRoute } from '@/app/api/companies/route';
import { POST as addMemberRoute } from '@/app/api/companies/[id]/members/route';
import { POST as submitApplicationRoute } from '@/app/api/manager-applications/route';
import { POST as adminReviewRoute } from '@/app/api/admin/manager-applications/[id]/route';
import { PATCH as adminSetRoleRoute } from '@/app/api/admin/managers/[companyId]/members/[userId]/route';
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

/** A verified, signed-in user. `asAdmin` promotes the platform role directly —
 * the platform deliberately has no endpoint for creating an admin. */
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
  return { agent: a, user: created.user, creds: u };
}

/** Approve a manager application, with no company attached. */
async function approveAsManagerless(admin: TestAgent, applicationId: string) {
  const { res, json } = await admin.callWithParams(
    adminReviewRoute,
    `/api/admin/manager-applications/${applicationId}`,
    { id: applicationId },
    { method: 'POST', body: { action: 'APPROVE' } },
  );
  expect(res.status).toBe(200);
  const decided = json as { status: string; companyId: string | null };
  expect(decided.status).toBe('APPROVED');
  expect(decided.companyId).toBeNull();
}

/** Take the product path to being a manager: apply, then get approved. */
async function becomeManagerViaApproval(applicant: { agent: TestAgent }, admin: TestAgent) {
  const submitted = await applicant.agent.call(submitApplicationRoute, '/api/manager-applications', {
    method: 'POST',
    body: {
      companyName: `My Own Co ${Date.now().toString(36)}`,
      position: 'Head of Ops',
      companySize: 12,
      teamCount: 2,
      teamSize: 6,
      message: 'I would like to run my own company.',
    },
  });
  expect(submitted.res.status).toBe(201);
  const appId = (submitted.json as { id: string }).id;
  await approveAsManagerless(admin, appId);
  return appId;
}

function createCompany(a: TestAgent, name: string) {
  return a.call(createCompanyRoute, '/api/companies', { method: 'POST', body: { name } });
}

async function createCompanyOk(a: TestAgent, name: string): Promise<string> {
  const { res, json } = await createCompany(a, name);
  expect(res.status).toBe(201);
  return (json as { company: { id: string } }).company.id;
}

function addMember(a: TestAgent, companyId: string, userId: string) {
  return a.callWithParams(
    addMemberRoute,
    `/api/companies/${companyId}/members`,
    { id: companyId },
    { method: 'POST', body: { userId, role: 'MEMBER' } },
  );
}

// ─── The create gate ────────────────────────────────────────────────────────

describe('only a manager or an admin may create a company', () => {
  it('refuses a plain user with 403 COMPANY_CREATE_FORBIDDEN', async () => {
    const user = await verifiedAgent('capPlain');
    const { res, json } = await createCompany(user.agent, 'Should Not Exist Co');
    expect(res.status).toBe(403);
    expect(errCode(json)).toBe('COMPANY_CREATE_FORBIDDEN');

    // Nothing was written — not the company, and not a membership.
    const count = await prisma.company.count({ where: { ownerId: user.user.id } });
    expect(count).toBe(0);
    const memberships = await prisma.companyMember.count({ where: { userId: user.user.id } });
    expect(memberships).toBe(0);
  });

  it('refuses a signed-out caller at the auth layer, before the gate', async () => {
    // `csrfOnly` gives a valid double-submit pair and no session, so the
    // request gets past the CSRF guard and fails on authentication — which is
    // the layer under test here. A bare agent would be stopped by CSRF first.
    const anon = new TestAgent({ csrfOnly: true });
    agents.push(anon);
    const { res, json } = await anon.call(createCompanyRoute, '/api/companies', {
      method: 'POST',
      body: { name: 'Anonymous Co' },
    });
    expect(res.status).toBe(401);
    // Not the company-specific code: an unauthenticated caller must not learn
    // that a create gate exists.
    expect(errCode(json)).toBe('UNAUTHENTICATED');
  });
});

// ─── The caps ───────────────────────────────────────────────────────────────

describe('the membership caps', () => {
  it('lets a manager create three companies and refuses the fourth', async () => {
    const applicant = await verifiedAgent('capMgr');
    const admin = await verifiedAgent('capMgrAdm', true);
    await becomeManagerViaApproval(applicant, admin.agent);

    const ids: string[] = [];
    for (let i = 1; i <= 3; i++) {
      ids.push(await createCompanyOk(applicant.agent, `Manager Co ${i} ${Date.now().toString(36)}`));
    }

    const fourth = await createCompany(applicant.agent, `Manager Co 4 ${Date.now().toString(36)}`);
    expect(fourth.res.status).toBe(409);
    expect(errCode(fourth.json)).toBe('COMPANY_LIMIT_REACHED');

    // Exactly three, and the creator is a MANAGER of each — never an OWNER.
    const memberships = await prisma.companyMember.findMany({
      where: { userId: applicant.user.id },
      select: { role: true, companyId: true },
    });
    expect(memberships).toHaveLength(3);
    expect(new Set(memberships.map((m) => m.companyId))).toEqual(new Set(ids));
    expect(memberships.every((m) => m.role === 'MANAGER')).toBe(true);
  });

  it('lets an admin create more than three', async () => {
    const admin = await verifiedAgent('capAdm', true);
    for (let i = 1; i <= 4; i++) {
      await createCompanyOk(admin.agent, `Admin Co ${i} ${Date.now().toString(36)}`);
    }
    const count = await prisma.companyMember.count({ where: { userId: admin.user.id } });
    expect(count).toBe(4);
  });

  it('a manager cannot add a user who is already in their one company', async () => {
    // Two companies, each with its own manager.
    const applicantA = await verifiedAgent('capA');
    const applicantB = await verifiedAgent('capB');
    const admin = await verifiedAgent('capCapAdm', true);
    await becomeManagerViaApproval(applicantA, admin.agent);
    await becomeManagerViaApproval(applicantB, admin.agent);
    const companyA = await createCompanyOk(applicantA.agent, `Cap A ${Date.now().toString(36)}`);
    const companyB = await createCompanyOk(applicantB.agent, `Cap B ${Date.now().toString(36)}`);

    // A plain user, in nobody's company.
    const member = await verifiedAgent('capMember');

    const first = await addMember(applicantA.agent, companyA, member.user.id);
    expect(first.res.status).toBe(201);

    // The cap belongs to the person being added, not to the manager adding
    // them: B's manager has room, but `member` does not.
    const second = await addMember(applicantB.agent, companyB, member.user.id);
    expect(second.res.status).toBe(409);
    expect(errCode(second.json)).toBe('COMPANY_LIMIT_REACHED');

    // And nothing was written by the refusal.
    const memberships = await prisma.companyMember.count({ where: { userId: member.user.id } });
    expect(memberships).toBe(1);
  });

  it('a manager can add a member who is still below their limit', async () => {
    const applicant = await verifiedAgent('capRoom');
    const admin = await verifiedAgent('capRoomAdm', true);
    await becomeManagerViaApproval(applicant, admin.agent);
    const companyId = await createCompanyOk(applicant.agent, `Room Co ${Date.now().toString(36)}`);

    const member = await verifiedAgent('capRoomMem');
    const added = await addMember(applicant.agent, companyId, member.user.id);
    expect(added.res.status).toBe(201);
    expect((added.json as { role: string }).role).toBe('MEMBER');
  });
});

// ─── The other source of the manager tier ───────────────────────────────────

describe('a manager whose tier comes from a company role', () => {
  it('opens the gate when the admin console grants MANAGER, and only then', async () => {
    // A company, run by a manager.
    const owner = await verifiedAgent('capRoleOwner');
    const admin = await verifiedAgent('capRoleAdm', true);
    await becomeManagerViaApproval(owner, admin.agent);
    const companyId = await createCompanyOk(owner.agent, `Role Co ${Date.now().toString(36)}`);

    // A plain member of that company.
    const promoted = await verifiedAgent('capRoleProm');
    const added = await addMember(owner.agent, companyId, promoted.user.id);
    expect(added.res.status).toBe(201);

    const before = await createCompany(promoted.agent, 'Before Grant Co');
    expect(before.res.status).toBe(403);
    expect(errCode(before.json)).toBe('COMPANY_CREATE_FORBIDDEN');

    // The admin console is the only door to the manager role.
    const grant = await admin.agent.callWithParams(
      adminSetRoleRoute,
      `/api/admin/managers/${companyId}/members/${promoted.user.id}`,
      { companyId, userId: promoted.user.id },
      { method: 'PATCH', body: { role: 'MANAGER' } },
    );
    expect(grant.res.status).toBe(200);

    // `manages` is the only thing that changed: this user has never applied.
    const applications = await prisma.managerApplication.count({
      where: { userId: promoted.user.id, status: 'APPROVED' },
    });
    expect(applications).toBe(0);

    const after = await createCompany(promoted.agent, `After Grant Co ${Date.now().toString(36)}`);
    expect(after.res.status).toBe(201);

    // Two memberships, both MANAGER: the grant upgraded the existing row, and
    // creating a company makes the creator its manager.
    const memberships = await prisma.companyMember.findMany({
      where: { userId: promoted.user.id },
      select: { role: true },
    });
    expect(memberships).toHaveLength(2);
    expect(memberships.map((m) => m.role)).toEqual(['MANAGER', 'MANAGER']);
  });
});

// ─── The deadlock the gate would otherwise create ───────────────────────────

describe('an approved manager with no company yet', () => {
  it('can create the company the approval told them to create', async () => {
    const applicant = await verifiedAgent('capApproved');
    const admin = await verifiedAgent('capApprovedAdm', true);

    // Before approval they are a plain user and cannot create anything.
    const tooEarly = await createCompany(applicant.agent, 'Too Early Co');
    expect(tooEarly.res.status).toBe(403);
    expect(errCode(tooEarly.json)).toBe('COMPANY_CREATE_FORBIDDEN');

    await becomeManagerViaApproval(applicant, admin.agent);

    // Approval granted no company role — there was no company to grant it in.
    const memberships = await prisma.companyMember.count({ where: { userId: applicant.user.id } });
    expect(memberships).toBe(0);

    // …and yet they may now create one. Without the approved-application
    // derivation in `resolveMemberTier` this is a 403, which would make the
    // approval notification ("create your company to open the Manager Panel")
    // impossible to follow.
    const companyId = await createCompanyOk(applicant.agent, `My Own Co ${Date.now().toString(36)}`);
    const membership = await prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId: applicant.user.id } },
    });
    expect(membership?.role).toBe('MANAGER');
  });

  it('gets a manager’s ceiling of three, not an admin’s infinity', async () => {
    const applicant = await verifiedAgent('capApproved3');
    const admin = await verifiedAgent('capApproved3Adm', true);
    await becomeManagerViaApproval(applicant, admin.agent);

    await createCompanyOk(applicant.agent, `Approved Co 1 ${Date.now().toString(36)}`);
    await createCompanyOk(applicant.agent, `Approved Co 2 ${Date.now().toString(36)}`);
    await createCompanyOk(applicant.agent, `Approved Co 3 ${Date.now().toString(36)}`);

    const fourth = await createCompany(applicant.agent, `Approved Co 4 ${Date.now().toString(36)}`);
    expect(fourth.res.status).toBe(409);
    expect(errCode(fourth.json)).toBe('COMPANY_LIMIT_REACHED');
  });

  it('is still a plain user while the application is only PENDING', async () => {
    const applicant = await verifiedAgent('capPending');
    const submitted = await applicant.agent.call(
      submitApplicationRoute,
      '/api/manager-applications',
      {
        method: 'POST',
        body: {
          companyName: 'Pending Co',
          position: 'Ops Lead',
          companySize: 5,
          teamCount: 1,
          teamSize: 5,
        },
      },
    );
    expect(submitted.res.status).toBe(201);

    // PENDING is not a grant. Waiting for review must not open the door.
    const attempt = await createCompany(applicant.agent, 'Pending Co Ltd');
    expect(attempt.res.status).toBe(403);
    expect(errCode(attempt.json)).toBe('COMPANY_CREATE_FORBIDDEN');
  });

  it('is still a plain user when the application was DECLINED', async () => {
    const applicant = await verifiedAgent('capDeclined');
    const admin = await verifiedAgent('capDeclinedAdm', true);
    const submitted = await applicant.agent.call(
      submitApplicationRoute,
      '/api/manager-applications',
      {
        method: 'POST',
        body: {
          companyName: 'Declined Co',
          position: 'Ops Lead',
          companySize: 5,
          teamCount: 1,
          teamSize: 5,
        },
      },
    );
    const appId = (submitted.json as { id: string }).id;

    const declined = await admin.agent.callWithParams(
      adminReviewRoute,
      `/api/admin/manager-applications/${appId}`,
      { id: appId },
      { method: 'POST', body: { action: 'DECLINE', note: 'Not this time.' } },
    );
    expect(declined.res.status).toBe(200);

    const attempt = await createCompany(applicant.agent, 'Declined Co Ltd');
    expect(attempt.res.status).toBe(403);
    expect(errCode(attempt.json)).toBe('COMPANY_CREATE_FORBIDDEN');
  });
});
