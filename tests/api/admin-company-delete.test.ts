/**
 * Permanently deleting a company from the admin console.
 *
 * This is the only irreversible action in the admin panel, so the interesting
 * behaviour is not the happy path — it is the two refusals that stand between a
 * misclick and lost data:
 *
 *   - a company that is still ACTIVE cannot be deleted. Deactivation is the
 *     reversible step and an admin who has not taken it has not yet decided the
 *     company should stop existing. Keeping the two apart is what makes "delete"
 *     safe to put in a menu at all.
 *   - the company's own manager cannot delete it. "Manage my company" and
 *     "erase my company" are different powers; only a platform admin holds the
 *     second, and this file proves the first does not imply it.
 *
 * The audit entry is checked too, because by the time anyone reads it the rows
 * it describes are gone — a log line reading "company deleted" without the
 * counts is not evidence of anything.
 *
 * Requires DATABASE_URL (see tests/setup.ts).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { signup } from '@/lib/services/auth';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as createCompanyRoute } from '@/app/api/companies/route';
import { PATCH as patchCompanyRoute } from '@/app/api/admin/managers/[companyId]/route';
import { DELETE as deleteCompanyRoute } from '@/app/api/admin/managers/[companyId]/route';
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

/** A verified, signed-in user. `asAdmin` writes platformRole directly — the
 *  platform deliberately has no API for minting admins. */
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
  return { agent: a, user: created.user };
}

/** A company created by its own manager, which is the interesting case: the
 *  person who runs it is exactly the person who must NOT be able to erase it. */
async function managerWithCompany(prefix: string) {
  const mgr = await verifiedAgent(`${prefix}Mgr`);
  await promoteToManager(mgr.user.id);
  const { res, json } = await mgr.agent.call(createCompanyRoute, '/api/companies', {
    method: 'POST',
    body: { name: `Delete Test ${prefix}` },
  });
  expect(res.status).toBe(201);
  const companyId = (json as { company: { id: string } }).company.id;
  return { mgr, companyId };
}

function callDelete(a: TestAgent, companyId: string) {
  return a.callWithParams(
    deleteCompanyRoute,
    `/api/admin/managers/${companyId}`,
    { companyId },
    { method: 'DELETE' },
  );
}

function callDeactivate(a: TestAgent, companyId: string) {
  return a.callWithParams(
    patchCompanyRoute,
    `/api/admin/managers/${companyId}`,
    { companyId },
    { method: 'PATCH', body: { isActive: false } },
  );
}

describe('deleting a company permanently', () => {
  it('refuses while the company is still active, and leaves it alone', async () => {
    const admin = await verifiedAgent('delActive', true);
    const { companyId } = await managerWithCompany('delActive');

    const { res, json } = await callDelete(admin.agent, companyId);

    expect(res.status).toBe(409);
    expect(errCode(json)).toBe('COMPANY_ACTIVE');
    // The refusal has to be real: the company is still there and still live.
    const row = await prisma.company.findUnique({ where: { id: companyId } });
    expect(row).not.toBeNull();
    expect(row?.isActive).toBe(true);
  });

  it('deletes once the company is deactivated', async () => {
    const admin = await verifiedAgent('delOk', true);
    const { companyId } = await managerWithCompany('delOk');

    const off = await callDeactivate(admin.agent, companyId);
    expect(off.res.status).toBe(200);

    const { res } = await callDelete(admin.agent, companyId);
    expect(res.status).toBe(204);

    expect(await prisma.company.findUnique({ where: { id: companyId } })).toBeNull();
  });

  it('cascades to the memberships and teams the company owned', async () => {
    const admin = await verifiedAgent('delCascade', true);
    const { mgr, companyId } = await managerWithCompany('delCascade');

    // Something for the cascade to actually remove.
    await prisma.team.create({ data: { companyId, name: 'Cascade Team' } });
    expect(await prisma.companyMember.count({ where: { companyId } })).toBe(1);

    await callDeactivate(admin.agent, companyId);
    const { res } = await callDelete(admin.agent, companyId);
    expect(res.status).toBe(204);

    expect(await prisma.companyMember.count({ where: { companyId } })).toBe(0);
    expect(await prisma.team.count({ where: { companyId } })).toBe(0);
    // The user survives — deleting a company must not delete people.
    expect(await prisma.user.findUnique({ where: { id: mgr.user.id } })).not.toBeNull();
  });

  it("refuses the company's own manager, and the company survives", async () => {
    const { mgr, companyId } = await managerWithCompany('delSelf');

    // Even deactivated: managing a company is not the power to erase it.
    await prisma.company.update({ where: { id: companyId }, data: { isActive: false } });

    const { res, json } = await callDelete(mgr.agent, companyId);

    expect(res.status).toBe(403);
    expect(errCode(json)).toBe('FORBIDDEN');
    expect(await prisma.company.findUnique({ where: { id: companyId } })).not.toBeNull();
  });

  it('404s for an id that does not exist', async () => {
    const admin = await verifiedAgent('delMissing', true);
    const { res, json } = await callDelete(admin.agent, 'cmnonexistent0000000000000');

    expect(res.status).toBe(404);
    expect(errCode(json)).toBe('NOT_FOUND');
  });

  it('records what was destroyed in the audit log, since the rows are gone', async () => {
    const admin = await verifiedAgent('delAudit', true);
    const { companyId } = await managerWithCompany('delAudit');
    await prisma.team.create({ data: { companyId, name: 'Audited Team' } });

    await callDeactivate(admin.agent, companyId);
    const { res } = await callDelete(admin.agent, companyId);
    expect(res.status).toBe(204);

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'admin.company_delete', entityId: companyId },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBe(admin.user.id);
    expect(entry?.entityType).toBe('company');

    const meta = entry?.metadata as Record<string, unknown>;
    expect(meta.memberCount).toBe(1);
    expect(meta.teamCount).toBe(1);
    expect(typeof meta.name).toBe('string');
  });
});
