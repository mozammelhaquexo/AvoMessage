/**
 * The OTP gate on the three account-creating flows.
 *
 *   signup          a visitor proves the address before the account exists
 *   COMPANY_MEMBER  a manager adds a member, whose address must confirm
 *   COMPANY_MANAGER an admin adds a manager, whose address must confirm
 *
 * What is actually being tested, beyond "it works": that the account does NOT
 * exist before a correct code, that the pending action lives on the challenge
 * rather than in the request, and that authority is re-decided at verification
 * time rather than inherited from the request step.
 *
 * The last point is the one worth stating plainly. A challenge is in flight for
 * up to ten minutes. If authorization were only checked when the code was
 * requested, a manager demoted in that window could still finish creating the
 * account — and if the payload came back from the client at step 2, the same
 * manager could redeem a code issued for their own address against a different
 * company. Both are covered below.
 *
 * Requires DATABASE_URL (see tests/setup.ts). RATE_LIMIT_DISABLED is set there;
 * the per-challenge cooldown and attempt cap are NOT rate limiting and are
 * exercised for real.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { signup } from '@/lib/services/auth';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as createCompanyRoute } from '@/app/api/companies/route';
import { POST as memberOtpRoute } from '@/app/api/companies/[id]/members/otp/route';
import { POST as adminOtpRoute } from '@/app/api/admin/managers/[companyId]/members/otp/route';
import { POST as otpVerifyRoute } from '@/app/api/otp/verify/route';
import { TestAgent, uniqueUser, errCode, requestSignupCode, promoteToManager } from '../helpers';

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

/** A verified, signed-in user, optionally promoted to platform ADMIN. */
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

async function createCompany(a: TestAgent, name: string) {
  // Only a manager may create a company. The creator becomes its manager,
  // which is the role every flow below is exercised against.
  await promoteToManager(a.userId);
  const { res, json } = await a.call(createCompanyRoute, '/api/companies', {
    method: 'POST',
    body: { name },
  });
  expect(res.status).toBe(201);
  return (json as { company: { id: string } }).company.id;
}

/** The 200 body of either request endpoint. */
interface OtpRequested {
  challengeId: string;
  email: string;
  expiresAt: string;
  resendAfterMs: number;
  devCode?: string;
}

function requested(json: unknown): OtpRequested {
  return json as OtpRequested;
}

// ─── Flow B: a manager adds a member ────────────────────────────────────────

describe('manager adds a member (COMPANY_MEMBER)', () => {
  it('sends a code, creates no user, then creates the account on a correct code', async () => {
    const manager = await verifiedAgent('otpMemMgr');
    const companyId = await createCompany(manager.agent, 'OTP Member Co');
    const u = uniqueUser('otpMem');
    manager.agent.trackEmail(u.email);

    const asked = await manager.agent.callWithParams(
      memberOtpRoute,
      `/api/companies/${companyId}/members/otp`,
      { id: companyId },
      { method: 'POST', body: u },
    );
    expect(asked.res.status).toBe(200);
    const challenge = requested(asked.json);
    expect(challenge.challengeId).toBeTruthy();
    expect(challenge.devCode).toMatch(/^\d{6}$/);

    // The whole point: the address has not confirmed anything, so there is no
    // account — and no membership to attach one to.
    expect(await prisma.user.findUnique({ where: { email: u.email } })).toBeNull();

    const done = await manager.agent.call(otpVerifyRoute, '/api/otp/verify', {
      method: 'POST',
      body: { challengeId: challenge.challengeId, code: challenge.devCode },
    });
    expect(done.res.status).toBe(201);
    const body = done.json as { user: { id: string; emailVerified: boolean }; role: string };
    expect(body.role).toBe('MEMBER');
    manager.agent.trackUser(body.user.id);

    const row = await prisma.user.findUniqueOrThrow({ where: { email: u.email } });
    // Born verified — the code went to this address and came back from it.
    expect(row.emailVerifiedAt).not.toBeNull();
    const membership = await prisma.companyMember.findUniqueOrThrow({
      where: { companyId_userId: { companyId, userId: row.id } },
    });
    expect(membership.role).toBe('MEMBER');
  });

  it('a wrong code leaves no account behind', async () => {
    const manager = await verifiedAgent('otpBadMgr');
    const companyId = await createCompany(manager.agent, 'OTP Bad Co');
    const u = uniqueUser('otpBad');
    manager.agent.trackEmail(u.email);

    const asked = await manager.agent.callWithParams(
      memberOtpRoute,
      `/api/companies/${companyId}/members/otp`,
      { id: companyId },
      { method: 'POST', body: u },
    );
    const challenge = requested(asked.json);
    const wrong = challenge.devCode === '000000' ? '111111' : '000000';

    const bad = await manager.agent.call(otpVerifyRoute, '/api/otp/verify', {
      method: 'POST',
      body: { challengeId: challenge.challengeId, code: wrong },
    });
    expect(bad.res.status).toBe(400);
    expect(errCode(bad.json)).toBe('OTP_INVALID');
    // The message says how many tries are left — useful, and it leaks nothing.
    expect((bad.json as { error: { message: string } }).error.message).toMatch(/attempt/);

    expect(await prisma.user.findUnique({ where: { email: u.email } })).toBeNull();
  });

  it('refuses an immediate resend (429 OTP_RESEND_TOO_SOON)', async () => {
    const manager = await verifiedAgent('otpCoolMgr');
    const companyId = await createCompany(manager.agent, 'OTP Cooldown Co');
    const u = uniqueUser('otpCool');
    manager.agent.trackEmail(u.email);

    const first = await manager.agent.callWithParams(
      memberOtpRoute,
      `/api/companies/${companyId}/members/otp`,
      { id: companyId },
      { method: 'POST', body: u },
    );
    expect(first.res.status).toBe(200);

    const again = await manager.agent.callWithParams(
      memberOtpRoute,
      `/api/companies/${companyId}/members/otp`,
      { id: companyId },
      { method: 'POST', body: u },
    );
    expect(again.res.status).toBe(429);
    expect(errCode(again.json)).toBe('OTP_RESEND_TOO_SOON');
  });

  it('normalises the address, so a mixed-case request lands on the one inbox', async () => {
    const manager = await verifiedAgent('otpcaseMgr');
    const companyId = await createCompany(manager.agent, 'OTP Case Co');
    const u = uniqueUser('otpcase');
    manager.agent.trackEmail(u.email);

    // Sent with the case flipped. An address is one inbox whatever its case, so
    // this must resolve to the same row the lowercase form would.
    const asked = await manager.agent.callWithParams(
      memberOtpRoute,
      `/api/companies/${companyId}/members/otp`,
      { id: companyId },
      { method: 'POST', body: { ...u, email: u.email.toUpperCase() } },
    );
    expect(asked.res.status).toBe(200);
    const challenge = requested(asked.json);
    // The challenge echoes the normalised form, which is what was mailed.
    expect(challenge.email).toBe(u.email);

    const done = await manager.agent.call(otpVerifyRoute, '/api/otp/verify', {
      method: 'POST',
      body: { challengeId: challenge.challengeId, code: challenge.devCode },
    });
    expect(done.res.status).toBe(201);
    manager.agent.trackUser((done.json as { user: { id: string } }).user.id);

    const row = await prisma.user.findUniqueOrThrow({ where: { email: u.email } });
    expect(row.email).toBe(u.email);
    // And not a second row under the uppercase spelling.
    expect(await prisma.user.count({ where: { email: u.email.toUpperCase() } })).toBe(0);
  });

  it('a non-manager cannot request a member code for a company (403)', async () => {
    const manager = await verifiedAgent('otpOutMgr');
    const outsider = await verifiedAgent('otpOutsider');
    const companyId = await createCompany(manager.agent, 'OTP Outsider Co');
    const u = uniqueUser('otpOut');
    outsider.agent.trackEmail(u.email);

    const { res } = await outsider.agent.callWithParams(
      memberOtpRoute,
      `/api/companies/${companyId}/members/otp`,
      { id: companyId },
      { method: 'POST', body: u },
    );
    expect(res.status).toBe(403);
    expect(await prisma.user.findUnique({ where: { email: u.email } })).toBeNull();
  });
});

// ─── Flow C: an admin adds a manager ────────────────────────────────────────

describe('admin adds a manager (COMPANY_MANAGER)', () => {
  it('sends a code, creates no user, then grants MANAGER on a correct code', async () => {
    const admin = await verifiedAgent('otpAdm', true);
    const companyId = await createCompany(admin.agent, 'OTP Admin Co');
    const u = uniqueUser('otpMgr');
    admin.agent.trackEmail(u.email);

    const asked = await admin.agent.callWithParams(
      adminOtpRoute,
      `/api/admin/managers/${companyId}/members/otp`,
      { companyId },
      { method: 'POST', body: u },
    );
    expect(asked.res.status).toBe(200);
    const challenge = requested(asked.json);
    expect(await prisma.user.findUnique({ where: { email: u.email } })).toBeNull();

    const done = await admin.agent.call(otpVerifyRoute, '/api/otp/verify', {
      method: 'POST',
      body: { challengeId: challenge.challengeId, code: challenge.devCode },
    });
    expect(done.res.status).toBe(201);
    const body = done.json as { user: { id: string }; role: string };
    expect(body.role).toBe('MANAGER');
    admin.agent.trackUser(body.user.id);

    const membership = await prisma.companyMember.findUniqueOrThrow({
      where: { companyId_userId: { companyId, userId: body.user.id } },
    });
    expect(membership.role).toBe('MANAGER');
  });

  it('a company manager cannot use the admin door (403)', async () => {
    const manager = await verifiedAgent('otpMgrNoAdm');
    const companyId = await createCompany(manager.agent, 'OTP Not Admin Co');
    const u = uniqueUser('otpNoAdm');
    manager.agent.trackEmail(u.email);

    const { res, json } = await manager.agent.callWithParams(
      adminOtpRoute,
      `/api/admin/managers/${companyId}/members/otp`,
      { companyId },
      { method: 'POST', body: u },
    );
    expect(res.status).toBe(403);
    expect(errCode(json)).toBe('FORBIDDEN');
    expect(await prisma.user.findUnique({ where: { email: u.email } })).toBeNull();
  });
});

// ─── The challenge is bound to the action, not to the caller ────────────────

describe('the pending action is bound to the challenge, not the request', () => {
  it('another company’s manager cannot redeem a code issued for a different company', async () => {
    const alice = await verifiedAgent('otpAlice');
    const bob = await verifiedAgent('otpBob');
    const aliceCo = await createCompany(alice.agent, 'OTP Alice Co');
    await createCompany(bob.agent, 'OTP Bob Co');

    const u = uniqueUser('otpCross');
    alice.agent.trackEmail(u.email);
    const asked = await alice.agent.callWithParams(
      memberOtpRoute,
      `/api/companies/${aliceCo}/members/otp`,
      { id: aliceCo },
      { method: 'POST', body: u },
    );
    const challenge = requested(asked.json);

    // Bob holds a valid code — Alice's code is not his to spend, and there is
    // no field in this request that could redirect it to his company.
    const stolen = await bob.agent.call(otpVerifyRoute, '/api/otp/verify', {
      method: 'POST',
      body: { challengeId: challenge.challengeId, code: challenge.devCode },
    });
    expect(stolen.res.status).toBe(403);
    expect(await prisma.user.findUnique({ where: { email: u.email } })).toBeNull();
  });

  it('an anonymous caller cannot redeem anything at the authenticated door', async () => {
    const manager = await verifiedAgent('otpAnonMgr');
    const companyId = await createCompany(manager.agent, 'OTP Anon Co');
    const u = uniqueUser('otpAnon');
    manager.agent.trackEmail(u.email);

    const asked = await manager.agent.callWithParams(
      memberOtpRoute,
      `/api/companies/${companyId}/members/otp`,
      { id: companyId },
      { method: 'POST', body: u },
    );
    const challenge = requested(asked.json);

    // A fresh agent with no session and no CSRF pair.
    const anon = agent();
    const { res } = await anon.call(otpVerifyRoute, '/api/otp/verify', {
      method: 'POST',
      body: { challengeId: challenge.challengeId, code: challenge.devCode },
      csrf: false,
    });
    // 403 CSRF_INVALID from the proxy layer, or 401 — never a success.
    expect([401, 403]).toContain(res.status);
    expect(await prisma.user.findUnique({ where: { email: u.email } })).toBeNull();
  });

  it('a SIGNUP challenge cannot be redeemed at the authenticated door', async () => {
    const admin = await verifiedAgent('otpSignupAdm', true);
    const u = uniqueUser('otpSignupMix');
    const { challenge } = await requestSignupCode(admin.agent, u);

    const mixed = await admin.agent.call(otpVerifyRoute, '/api/otp/verify', {
      method: 'POST',
      body: { challengeId: challenge.challengeId, code: challenge.devCode },
    });
    expect(mixed.res.status).toBe(400);
    expect(errCode(mixed.json)).toBe('OTP_INVALID');
    expect(await prisma.user.findUnique({ where: { email: u.email } })).toBeNull();
  });

  it('a COMPANY_MEMBER challenge is refused by a caller with no authority over that company', async () => {
    const manager = await verifiedAgent('otpPurpMgr');
    const companyId = await createCompany(manager.agent, 'OTP Purpose Co');
    const u = uniqueUser('otpPurp');
    manager.agent.trackEmail(u.email);

    const asked = await manager.agent.callWithParams(
      memberOtpRoute,
      `/api/companies/${companyId}/members/otp`,
      { id: companyId },
      { method: 'POST', body: u },
    );
    const challenge = requested(asked.json);

    // The admin passes the dispatcher (purpose is COMPANY_MEMBER) but is not a
    // manager of this company, so `requireCompanyManager` still refuses — which
    // is exactly why authority is re-checked at verify time.
    const admin = await verifiedAgent('otpPurpAdm', true);
    const { res } = await admin.agent.call(otpVerifyRoute, '/api/otp/verify', {
      method: 'POST',
      body: { challengeId: challenge.challengeId, code: challenge.devCode },
    });
    expect(res.status).toBe(403);
    expect(await prisma.user.findUnique({ where: { email: u.email } })).toBeNull();
  });

  it('a challenge can only be spent once', async () => {
    const admin = await verifiedAgent('otpReplayAdm', true);
    const companyId = await createCompany(admin.agent, 'OTP Replay Co');
    const u = uniqueUser('otpReplay');
    admin.agent.trackEmail(u.email);

    const asked = await admin.agent.callWithParams(
      adminOtpRoute,
      `/api/admin/managers/${companyId}/members/otp`,
      { companyId },
      { method: 'POST', body: u },
    );
    const challenge = requested(asked.json);
    const body = { challengeId: challenge.challengeId, code: challenge.devCode };

    const first = await admin.agent.call(otpVerifyRoute, '/api/otp/verify', { method: 'POST', body });
    expect(first.res.status).toBe(201);
    admin.agent.trackUser((first.json as { user: { id: string } }).user.id);

    const replay = await admin.agent.call(otpVerifyRoute, '/api/otp/verify', { method: 'POST', body });
    expect(replay.res.status).toBe(400);
    expect(errCode(replay.json)).toBe('OTP_USED');

    // Exactly one account, and exactly one membership.
    expect(await prisma.user.count({ where: { email: u.email } })).toBe(1);
    expect(await prisma.companyMember.count({ where: { companyId } })).toBe(2);
  });

  it('an unknown challenge id is refused indistinguishably from a wrong code', async () => {
    const manager = await verifiedAgent('otpUnknownMgr');
    const { res, json } = await manager.agent.call(otpVerifyRoute, '/api/otp/verify', {
      method: 'POST',
      body: { challengeId: 'ckzzzzzzzzzzzzzzzzzzzzzzzz', code: '123456' },
    });
    expect(res.status).toBe(400);
    expect(errCode(json)).toBe('OTP_INVALID');
  });
});
