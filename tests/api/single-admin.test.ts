/**
 * There is exactly one platform administrator (part 2, request 4).
 *
 * Split deliberately in two, because the rule depends on how many admins exist
 * in the database and the API tests share one database across parallel files:
 *
 *   1. `checkSingleAdminRule` is a pure function of (currentRole, nextRole,
 *      otherAdminCount). Every branch is reachable by passing a number, so the
 *      LAST_ADMIN branch is proven here rather than by trying to arrange a
 *      single-admin database mid-suite — an arrangement another test file would
 *      happily break.
 *   2. The HTTP tests then pin the facts that hold no matter who else is in the
 *      database: promotion is always refused (a seeded admin always exists), a
 *      normal user has no business here, and the permission matrix stopped
 *      advertising a capability the server refuses.
 *
 * Requires DATABASE_URL (see tests/setup.ts).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { signup } from '@/lib/services/auth';
import {
  checkSingleAdminRule,
  isPlatformAdminRole,
} from '@/lib/services/platform-admin-policy';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { PATCH as adminUpdateUserRoute } from '@/app/api/admin/users/[id]/route';
import { GET as adminRolesRoute } from '@/app/api/admin/roles/route';
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

/**
 * A signed-in user. `asAdmin` sets the platform role directly, because the
 * platform deliberately has no endpoint that can.
 */
async function verifiedAgent(prefix: string, asAdmin: false | 'ADMIN' | 'SUPER_ADMIN' = false) {
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
    await prisma.user.update({ where: { id: created.user.id }, data: { platformRole: asAdmin } });
  }
  const login = await a.call(loginRoute, '/api/auth/login', {
    method: 'POST',
    body: { email: u.email, password: u.password },
    csrf: false,
  });
  expect(login.res.status).toBe(200);
  return { agent: a, user: created.user };
}

async function setRole(a: TestAgent, targetId: string, platformRole: string) {
  return a.callWithParams(
    adminUpdateUserRoute,
    `/api/admin/users/${targetId}`,
    { id: targetId },
    { method: 'PATCH', body: { platformRole } },
  );
}

describe('the one-admin rule, as a decision', () => {
  it('counts ADMIN and SUPER_ADMIN as the same administrator', () => {
    expect(isPlatformAdminRole('ADMIN')).toBe(true);
    expect(isPlatformAdminRole('SUPER_ADMIN')).toBe(true);
    expect(isPlatformAdminRole('USER')).toBe(false);
  });

  it('refuses to promote a user while another admin exists', () => {
    expect(checkSingleAdminRule('USER', 'ADMIN', 1)).toBe('SINGLE_ADMIN_ONLY');
    expect(checkSingleAdminRule('USER', 'SUPER_ADMIN', 1)).toBe('SINGLE_ADMIN_ONLY');
    expect(checkSingleAdminRule('USER', 'ADMIN', 5)).toBe('SINGLE_ADMIN_ONLY');
  });

  it('allows the bootstrap case — promotion when the platform has no admin at all', () => {
    // Unreachable through the API (only an admin can call it), but the function
    // stays total rather than silently refusing a state it cannot occur in.
    expect(checkSingleAdminRule('USER', 'ADMIN', 0)).toBe('ok');
  });

  it('refuses to demote the last administrator', () => {
    expect(checkSingleAdminRule('ADMIN', 'USER', 0)).toBe('LAST_ADMIN');
    expect(checkSingleAdminRule('SUPER_ADMIN', 'USER', 0)).toBe('LAST_ADMIN');
  });

  it('allows a demote when another admin remains', () => {
    expect(checkSingleAdminRule('ADMIN', 'USER', 1)).toBe('ok');
    expect(checkSingleAdminRule('SUPER_ADMIN', 'USER', 3)).toBe('ok');
  });

  it('allows a same-role write and a move between the two admin roles', () => {
    // ADMIN → SUPER_ADMIN with no other admin is still one administrator.
    expect(checkSingleAdminRule('ADMIN', 'SUPER_ADMIN', 0)).toBe('ok');
    expect(checkSingleAdminRule('SUPER_ADMIN', 'ADMIN', 0)).toBe('ok');
    expect(checkSingleAdminRule('ADMIN', 'ADMIN', 0)).toBe('ok');
    expect(checkSingleAdminRule('USER', 'USER', 0)).toBe('ok');
  });
});

describe('a second administrator cannot be created over HTTP', () => {
  it('refuses to promote a normal user to ADMIN', async () => {
    const admin = await verifiedAgent('oneAdm', 'SUPER_ADMIN');
    const normal = await verifiedAgent('oneUsr');

    const { res, json } = await setRole(admin.agent, normal.user.id, 'ADMIN');
    expect(res.status).toBe(409);
    expect(errCode(json)).toBe('SINGLE_ADMIN_ONLY');

    const row = await prisma.user.findUniqueOrThrow({ where: { id: normal.user.id } });
    expect(row.platformRole).toBe('USER');
  });

  it('refuses to promote a normal user to SUPER_ADMIN', async () => {
    const admin = await verifiedAgent('oneAdm2', 'SUPER_ADMIN');
    const normal = await verifiedAgent('oneUsr2');

    const { res, json } = await setRole(admin.agent, normal.user.id, 'SUPER_ADMIN');
    expect(res.status).toBe(409);
    expect(errCode(json)).toBe('SINGLE_ADMIN_ONLY');

    const row = await prisma.user.findUniqueOrThrow({ where: { id: normal.user.id } });
    expect(row.platformRole).toBe('USER');
  });

  it('gives a normal user nothing: the admin guard fires first', async () => {
    const normal = await verifiedAgent('oneNo');
    const other = await verifiedAgent('oneNoTarget');
    const { res, json } = await setRole(normal.agent, other.user.id, 'ADMIN');
    expect(res.status).toBe(403);
    expect(errCode(json)).toBe('FORBIDDEN');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: other.user.id } });
    expect(row.platformRole).toBe('USER');
  });

  it('still lets the admin do the rest of the job — suspend a normal user', async () => {
    const admin = await verifiedAgent('oneAdm3', 'SUPER_ADMIN');
    const normal = await verifiedAgent('oneUsr3');
    const { res } = await admin.agent.callWithParams(
      adminUpdateUserRoute,
      `/api/admin/users/${normal.user.id}`,
      { id: normal.user.id },
      { method: 'PATCH', body: { isActive: false } },
    );
    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: normal.user.id } });
    expect(row.isActive).toBe(false);
  });
});

describe('the permission matrix tells the truth', () => {
  it('no longer advertises a capability that could grant admin', async () => {
    const admin = await verifiedAgent('matrixAdm', 'SUPER_ADMIN');
    const { res, json } = await admin.agent.call(adminRolesRoute, '/api/admin/roles');
    expect(res.status).toBe(200);
    const matrix = (json as { matrix: Record<string, string[]> }).matrix;
    expect(Object.keys(matrix)).not.toContain('platform.grant_admin');
    // Grant and revoke of the company Manager role are now separate rows, and
    // only an admin can grant.
    expect(matrix['company.grant_manager_role']).toEqual(['SUPER_ADMIN', 'ADMIN']);
    expect(matrix['company.revoke_manager_role']).toEqual(['MANAGER']);
    expect(Object.keys(matrix)).not.toContain('company.change_role');
  });
});
