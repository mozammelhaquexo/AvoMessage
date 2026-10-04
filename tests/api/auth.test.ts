/**
 * Auth flow tests: signup → verify → login, lockout, password reset,
 * sessions, and validation. Requires DATABASE_URL (see tests/setup.ts).
 *
 * Signup is two calls now: `POST /api/auth/signup` sends a code and creates
 * nothing (202), and `POST /api/auth/signup/verify` is what brings the account
 * into existence (201). Tests that just want "an account" use `signupViaOtp`;
 * tests that care about the gate drive the two calls themselves.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { TokenType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { issueToken } from '@/lib/auth/tokens';
import { signup } from '@/lib/services/auth';
import { POST as signupRoute } from '@/app/api/auth/signup/route';
import { POST as signupVerifyRoute } from '@/app/api/auth/signup/verify/route';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as logoutRoute } from '@/app/api/auth/logout/route';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import { POST as resendRoute } from '@/app/api/auth/resend-verification/route';
import { POST as forgotRoute } from '@/app/api/auth/forgot-password/route';
import { POST as resetRoute } from '@/app/api/auth/reset-password/route';
import { GET as meRoute } from '@/app/api/auth/me/route';
import { GET as sessionsRoute, DELETE as revokeOthersRoute } from '@/app/api/auth/sessions/route';
import { DELETE as revokeOneRoute } from '@/app/api/auth/sessions/[id]/route';
import {
  TestAgent,
  uniqueUser,
  errCode,
  requestSignupCode,
  signupViaOtp,
} from '../helpers';

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

describe('signup → verify → login', () => {
  it('step 1 sends a code (202) and creates nothing — no user, no session', async () => {
    const a = agent();
    const u = uniqueUser('su');
    const { res, challenge } = await requestSignupCode(a, u);

    // 202, not 201: the request was accepted and processing is pending. A 201
    // here would be a lie the client could act on.
    expect(res.status).toBe(202);
    expect(challenge.challengeId).toBeTruthy();
    expect(challenge.devCode).toMatch(/^\d{6}$/);

    // The whole point: nothing exists yet, and no session was handed out.
    expect(a.cookies.has('avo_session')).toBeFalsy();
    expect(a.cookies.has('avo_csrf')).toBeFalsy();
    expect(await prisma.user.findUnique({ where: { email: u.email } })).toBeNull();

    // And the credentials cannot be used yet either.
    const early = await a.call(loginRoute, '/api/auth/login', {
      method: 'POST',
      body: { email: u.email, password: u.password },
      csrf: false,
    });
    expect(early.res.status).toBe(401);
  });

  it('step 2 with the correct code creates a verified account (201) and a session', async () => {
    const a = agent();
    const u = uniqueUser('su2');
    const { res, json, challenge } = await signupViaOtp(a, u);

    expect(res.status).toBe(201);
    expect(a.cookies.get('avo_session')).toBeTruthy();
    expect(a.cookies.get('avo_csrf')).toBeTruthy();
    const user = (json as { user: { emailVerified: boolean; id: string } }).user;
    // The code proved the address, so the account is born verified — there is
    // no verification link to follow.
    expect(user.emailVerified).toBe(true);
    a.trackUser(user.id);

    const me = await a.call(meRoute, '/api/auth/me');
    expect(me.res.status).toBe(200);
    expect((me.json as { user: { username: string } }).user.username).toBe(u.username);

    // The challenge is consumed: the same code cannot be replayed.
    const replay = await a.call(signupVerifyRoute, '/api/auth/signup/verify', {
      method: 'POST',
      body: { challengeId: challenge.challengeId, code: challenge.devCode },
      csrf: false,
    });
    expect(replay.res.status).toBe(400);
    expect(errCode(replay.json)).toBe('OTP_USED');
  });

  it('step 2 with a wrong code creates nothing and is refused (400 OTP_INVALID)', async () => {
    const a = agent();
    const u = uniqueUser('su3');
    const { challenge } = await requestSignupCode(a, u);
    // A code that is guaranteed to differ from the issued one.
    const wrong = challenge.devCode === '000000' ? '111111' : '000000';

    const bad = await a.call(signupVerifyRoute, '/api/auth/signup/verify', {
      method: 'POST',
      body: { challengeId: challenge.challengeId, code: wrong },
      csrf: false,
    });
    expect(bad.res.status).toBe(400);
    expect(errCode(bad.json)).toBe('OTP_INVALID');

    expect(await prisma.user.findUnique({ where: { email: u.email } })).toBeNull();
    expect(a.cookies.has('avo_session')).toBeFalsy();
  });

  it('rejects duplicate email (409 EMAIL_TAKEN) and username (409 USERNAME_TAKEN)', async () => {
    const a = agent();
    const u = uniqueUser('dup');
    const first = await signupViaOtp(a, u);
    expect(first.res.status).toBe(201);
    a.trackUser((first.json as { user: { id: string } }).user.id);

    const b = agent();
    const dupEmail = await b.call(signupRoute, '/api/auth/signup', {
      method: 'POST',
      body: { ...uniqueUser('dup2'), email: u.email },
      csrf: false,
    });
    expect(dupEmail.res.status).toBe(409);
    expect(errCode(dupEmail.json)).toBe('EMAIL_TAKEN');

    const dupUsername = await b.call(signupRoute, '/api/auth/signup', {
      method: 'POST',
      body: { ...uniqueUser('dup3'), username: u.username },
      csrf: false,
    });
    expect(dupUsername.res.status).toBe(409);
    expect(errCode(dupUsername.json)).toBe('USERNAME_TAKEN');
  });

  it('rejects invalid input with 400 VALIDATION_ERROR + fields', async () => {
    const a = agent();
    const { res, json } = await a.call(signupRoute, '/api/auth/signup', {
      method: 'POST',
      body: { name: '', username: 'x', email: 'not-an-email', password: 'short' },
      csrf: false,
    });
    expect(res.status).toBe(400);
    expect(errCode(json)).toBe('VALIDATION_ERROR');
    const fields = (json as { error: { fields: Record<string, string[]> } }).error.fields;
    expect(Object.keys(fields).length).toBeGreaterThan(0);
  });

  it('verifies email via token, then login reports emailVerified=true', async () => {
    // Mint through the service to capture the raw token (the route never exposes it).
    const u = uniqueUser('ve');
    const created = await signup(
      { name: u.name, username: u.username, email: u.email, password: u.password },
      {},
    );
    const svcAgent = agent();
    svcAgent.trackUser(created.user.id);

    const { res } = await svcAgent.call(verifyEmailRoute, '/api/auth/verify-email', {
      method: 'POST',
      body: { token: created.verificationToken },
      csrf: false,
    });
    expect(res.status).toBe(200);

    // Reusing the token fails (single-use).
    const reuse = await svcAgent.call(verifyEmailRoute, '/api/auth/verify-email', {
      method: 'POST',
      body: { token: created.verificationToken },
      csrf: false,
    });
    expect(reuse.res.status).toBe(400);
    expect(errCode(reuse.json)).toBe('TOKEN_USED');

    const login = await svcAgent.call(loginRoute, '/api/auth/login', {
      method: 'POST',
      body: { email: u.email, password: u.password },
      csrf: false,
    });
    expect(login.res.status).toBe(200);
    expect((login.json as { emailVerified: boolean }).emailVerified).toBe(true);
  });

  it('rejects garbage verification tokens (400 TOKEN_INVALID)', async () => {
    const a = agent();
    const { res, json } = await a.call(verifyEmailRoute, '/api/auth/verify-email', {
      method: 'POST',
      body: { token: 'deadbeef'.repeat(8) },
      csrf: false,
    });
    expect(res.status).toBe(400);
    expect(errCode(json)).toBe('TOKEN_INVALID');
  });
});

describe('login security', () => {
  it('unverified users get a limited session: writes blocked with EMAIL_UNVERIFIED', async () => {
    // OTP signup produces a *verified* account by construction, so this needs
    // the legacy link flow, which is the only remaining way to hold an
    // unverified user. Minted through the service to reach that state directly.
    const u = uniqueUser('lim');
    const created = await signup(
      { name: u.name, username: u.username, email: u.email, password: u.password },
      {},
    );
    const a = agent();
    a.trackUser(created.user.id);

    // Login succeeds and sets a session…
    const login = await a.call(loginRoute, '/api/auth/login', {
      method: 'POST',
      body: { email: u.email, password: u.password },
      csrf: false,
    });
    expect(login.res.status).toBe(200);
    expect((login.json as { emailVerified: boolean }).emailVerified).toBe(false);

    // …but writes are blocked until verification.
    const { POST: createPost } = await import('@/app/api/posts/route');
    const post = await a.call(createPost, '/api/posts', {
      method: 'POST',
      body: { body: 'hello world' },
    });
    expect(post.res.status).toBe(403);
    expect(errCode(post.json)).toBe('EMAIL_UNVERIFIED');
  });

  it('locks out after 5 wrong passwords (423 ACCOUNT_LOCKED)', async () => {
    const a = agent();
    const u = uniqueUser('lock');
    const s = await signupViaOtp(a, u);
    a.trackUser((s.json as { user: { id: string } }).user.id);

    for (let i = 0; i < 5; i++) {
      const bad = await a.call(loginRoute, '/api/auth/login', {
        method: 'POST',
        body: { email: u.email, password: 'wrong-password' },
        csrf: false,
      });
      expect(bad.res.status).toBe(401);
      expect(errCode(bad.json)).toBe('INVALID_CREDENTIALS');
    }
    const locked = await a.call(loginRoute, '/api/auth/login', {
      method: 'POST',
      body: { email: u.email, password: 'wrong-password' },
      csrf: false,
    });
    expect(locked.res.status).toBe(423);
    expect(errCode(locked.json)).toBe('ACCOUNT_LOCKED');

    // Even the correct password is rejected while locked.
    const correctWhileLocked = await a.call(loginRoute, '/api/auth/login', {
      method: 'POST',
      body: { email: u.email, password: u.password },
      csrf: false,
    });
    expect(correctWhileLocked.res.status).toBe(423);
  });

  it('forgot-password never enumerates (always 200)', async () => {
    const a = agent();
    const unknown = await a.call(forgotRoute, '/api/auth/forgot-password', {
      method: 'POST',
      body: { email: 'nobody-knows-me@example.com' },
      csrf: false,
    });
    expect(unknown.res.status).toBe(200);
    expect((unknown.json as { ok: boolean }).ok).toBe(true);
  });

  it('reset-password consumes a single-use token and revokes all sessions', async () => {
    const a = agent();
    const u = uniqueUser('rst');
    const s = await signupViaOtp(a, u);
    const userId = (s.json as { user: { id: string } }).user.id;
    a.trackUser(userId);
    const oldSessionCookie = a.cookies.get('avo_session');

    const { raw } = await issueToken(userId, TokenType.PASSWORD_RESET);
    const reset = await a.call(resetRoute, '/api/auth/reset-password', {
      method: 'POST',
      body: { token: raw, password: 'brand-new-password-9' },
      csrf: false,
    });
    expect(reset.res.status).toBe(200);

    // Old session is dead…
    const stale = new TestAgent();
    agents.push(stale);
    stale.cookies.set('avo_session', oldSessionCookie!);
    const meStale = await stale.call(meRoute, '/api/auth/me');
    expect(meStale.res.status).toBe(401);

    // …and the new password works.
    const login = await a.call(loginRoute, '/api/auth/login', {
      method: 'POST',
      body: { email: u.email, password: 'brand-new-password-9' },
      csrf: false,
    });
    expect(login.res.status).toBe(200);
  });

  it('resend-verification: verified → 409 ALREADY_VERIFIED; cooldown → 429', async () => {
    const u = uniqueUser('rsv');
    const created = await signup(
      { name: u.name, username: u.username, email: u.email, password: u.password },
      {},
    );
    const a = agent();
    a.trackUser(created.user.id);
    // Log in via route to get cookies for the 🔒 resend endpoint.
    const login = await a.call(loginRoute, '/api/auth/login', {
      method: 'POST',
      body: { email: u.email, password: u.password },
      csrf: false,
    });
    expect(login.res.status).toBe(200);

    // Immediate resend → cooldown 429 (signup already issued one).
    const cold = await a.call(resendRoute, '/api/auth/resend-verification', { method: 'POST', body: {} });
    expect(cold.res.status).toBe(429);

    // Verify, then resend → 409.
    await a.call(verifyEmailRoute, '/api/auth/verify-email', {
      method: 'POST',
      body: { token: created.verificationToken },
      csrf: false,
    });
    const done = await a.call(resendRoute, '/api/auth/resend-verification', { method: 'POST', body: {} });
    expect(done.res.status).toBe(409);
    expect(errCode(done.json)).toBe('ALREADY_VERIFIED');
  });
});

describe('logout + sessions', () => {
  it('logout revokes the session and clears cookies', async () => {
    const a = agent();
    const u = uniqueUser('lo');
    const s = await signupViaOtp(a, u);
    a.trackUser((s.json as { user: { id: string } }).user.id);

    const out = await a.call(logoutRoute, '/api/auth/logout', { method: 'POST', body: {} });
    expect(out.res.status).toBe(200);
    expect(a.cookies.has('avo_session')).toBe(false);

    const me = await a.call(meRoute, '/api/auth/me');
    expect(me.res.status).toBe(401);
  });

  it('lists sessions and revokes one / all-others', async () => {
    const a = agent();
    const b = agent();
    const u = uniqueUser('sess');
    const s = await signupViaOtp(a, u);
    a.trackUser((s.json as { user: { id: string } }).user.id);
    await b.call(loginRoute, '/api/auth/login', {
      method: 'POST',
      body: { email: u.email, password: u.password },
      csrf: false,
    });

    const list = await a.call(sessionsRoute, '/api/auth/sessions');
    expect(list.res.status).toBe(200);
    const sessions = (list.json as { data: Array<{ id: string; current: boolean }> }).data;
    expect(sessions.length).toBe(2);
    const other = sessions.find((x) => !x.current)!;
    expect(other).toBeTruthy();

    // Revoking the current session via this route is forbidden.
    const current = sessions.find((x) => x.current)!;
    const noSelf = await a.callWithParams(revokeOneRoute, `/api/auth/sessions/${current.id}`, { id: current.id }, { method: 'DELETE' });
    expect(noSelf.res.status).toBe(403);

    // Revoke the other session → its agent is logged out.
    const gone = await a.callWithParams(revokeOneRoute, `/api/auth/sessions/${other.id}`, { id: other.id }, { method: 'DELETE' });
    expect(gone.res.status).toBe(200);
    const bMe = await b.call(meRoute, '/api/auth/me');
    expect(bMe.res.status).toBe(401);

    // Revoke-others with a single remaining session is a no-op success.
    const all = await a.call(revokeOthersRoute, '/api/auth/sessions', { method: 'DELETE' });
    expect(all.res.status).toBe(200);
  });
});

describe('login activity + suspended accounts', () => {
  it('suspended users get 403 ACCOUNT_SUSPENDED', async () => {
    const a = agent();
    const u = uniqueUser('susp');
    const s = await signupViaOtp(a, u);
    const userId = (s.json as { user: { id: string } }).user.id;
    a.trackUser(userId);

    // Simulate an admin suspension (admin routes are Engineer B's domain).
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });

    const login = await a.call(loginRoute, '/api/auth/login', {
      method: 'POST',
      body: { email: u.email, password: u.password },
      csrf: false,
    });
    expect(login.res.status).toBe(403);
    expect(errCode(login.json)).toBe('ACCOUNT_SUSPENDED');

    await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
  });
});

beforeAll(async () => {
  // Sanity: DB reachable before running the suite.
  await prisma.$queryRaw`SELECT 1`;
});
