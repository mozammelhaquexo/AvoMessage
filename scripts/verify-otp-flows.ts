/**
 * scripts/verify-otp-flows.ts — drive all three OTP flows against the running
 * dev server over real HTTP, and check the database directly for the claims
 * that matter.
 *
 * The claim worth proving is not "the endpoint returned 201". It is:
 *
 *   NO USER ROW EXISTS until a correct code is entered.
 *
 * So each flow is checked in three steps — request, assert absent, verify,
 * assert present — with the absence read straight out of Postgres rather than
 * inferred from an HTTP status. A test that only checked the status code would
 * pass just as happily against the old flow, which created the account up front.
 *
 * ── Run it against a server with the rate limiter ON ───────────────────────
 *
 * Do NOT start the dev server with `RATE_LIMIT_DISABLED=1` to run this. The
 * per-IP limiter is part of what is being verified, and each section below
 * claims its own simulated address (`x-forwarded-for`) so the sections do not
 * spend each other's budget. The last section proves the limiter actually
 * bites, which a disabled limiter could never show.
 *
 * ── …and with the log mailer ───────────────────────────────────────────────
 *
 * This script reads the code out of the JSON response, which only carries it
 * when the mailer cannot actually deliver the message — see `devCodeFor()` in
 * lib/services/otp.ts. With a real driver the code goes to the inbox and
 * nowhere else, which is the whole point of the feature, so there is nothing
 * for this script to read.
 *
 *   MAILER_DRIVER=log npm run dev
 *
 * If a section reports "no devCode", that is the reason, not a broken flow.
 *
 * Run:  npx tsx scripts/verify-otp-flows.ts [baseUrl]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function loadEnv(): void {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const BASE = process.argv.find((a) => /^https?:\/\//.test(a)) ?? 'http://localhost:3000';

// ── tiny cookie jar ─────────────────────────────────────────────────────────
function jar() {
  const store = new Map<string, string>();
  return {
    header: () => [...store].map(([k, v]) => `${k}=${v}`).join('; '),
    get: (k: string) => store.get(k),
    absorb: (res: Response) => {
      for (const line of res.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(';');
        const i = pair.indexOf('=');
        if (i > 0) store.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
  };
}
type Jar = ReturnType<typeof jar>;

interface Reply {
  status: number;
  json: Record<string, unknown>;
  raw: string;
}

async function call(
  path: string,
  opts: { method?: string; body?: unknown; jar?: Jar; ip?: string } = {},
): Promise<Reply> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (opts.jar) headers.cookie = opts.jar.header();
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  // Every request is attributed to a caller-chosen address.
  //
  // The `otp` rate limit is 6/min keyed `otp:<ip>`, so a single-IP sweep of
  // ~35 checks would spend the whole budget in the first few and then report
  // failures that are really just the limiter working. Rather than switch the
  // limiter off (`RATE_LIMIT_DISABLED=1`, which is how this script used to be
  // run and which made it pass for the wrong reason), each section claims its
  // own address. The limiter stays on, and the section at the end proves it
  // actually bites.
  //
  // That this works at all is a property of `getClientIp` (lib/rate-limit.ts),
  // which trusts `x-forwarded-for` — correct behind a proxy that overwrites it,
  // and the reason that assumption is worth stating out loud.
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;
  if (method !== 'GET' && opts.jar) {
    const token = opts.jar.get('avo_csrf');
    if (token) headers['x-csrf-token'] = token;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
  opts.jar?.absorb(res);
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(raw);
  } catch {
    json = { _raw: raw.slice(0, 300) };
  }
  return { status: res.status, json, raw };
}

/**
 * A distinct simulated client address per section. `198.51.100.0/24` is the
 * TEST-NET-2 range, reserved for documentation — it cannot be a real caller.
 */
const IP = (n: number) => `198.51.100.${n}`;

async function login(email: string, password: string, ip?: string): Promise<Jar> {
  const j = jar();
  await fetch(`${BASE}/login`, { redirect: 'manual' }).then((r) => j.absorb(r));
  const res = await call('/api/auth/login', { method: 'POST', body: { email, password }, jar: j, ip });
  if (res.status !== 200) {
    throw new Error(`login ${email} → ${res.status} ${res.raw.slice(0, 200)}`);
  }
  return j;
}

const errCode = (r: Reply) =>
  ((r.json.error as { code?: string } | undefined)?.code ?? null) as string | null;

// ── reporting ───────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * The code is echoed in the response only when the mailer cannot deliver it, so
 * a missing `devCode` means this script is pointed at a server running real
 * SMTP — not that the flow is broken. Say which, in the failure text, rather
 * than leaving a bare "expected string, got undefined".
 */
function checkDevCode(label: string, value: unknown): boolean {
  const ok = typeof value === 'string' && /^\d{6}$/.test(value);
  check(
    label,
    ok,
    ok
      ? (value as string)
      : 'none — is the server on the log mailer? (MAILER_DRIVER=log npm run dev)',
  );
  return ok;
}

function stamp(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

async function main(): Promise<void> {
  loadEnv();
  const { prisma } = await import('../lib/db');

  const created: string[] = [];
  const s = stamp();

  try {
    // ══ Flow A — public signup ═════════════════════════════════════════════
    console.log('\n══ Flow A: signup requires OTP before the account exists ══');
    const ipA = IP(10);
    const signupEmail = `otp_signup_${s}@example.com`;
    const signupUsername = `otp_sign_${s}`.slice(0, 24);
    const password = 'correct-horse-8';

    const signupRes = await call('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Otp Signup', username: signupUsername, email: signupEmail, password },
      ip: ipA,
    });
    const signupBody = signupRes.json as {
      challengeId?: string;
      devCode?: string;
      expiresAt?: string;
      resendAfterMs?: number;
    };
    check('POST /api/auth/signup → 202', signupRes.status === 202, `got ${signupRes.status}`);
    check('returns a challengeId', typeof signupBody.challengeId === 'string');
    checkDevCode('returns devCode (log mailer only)', signupBody.devCode);
    check(
      'reports a resend cooldown',
      typeof signupBody.resendAfterMs === 'number' && signupBody.resendAfterMs > 0,
      `${signupBody.resendAfterMs}ms`,
    );

    const before = await prisma.user.findUnique({ where: { email: signupEmail } });
    check('NO user row exists yet', before === null);

    const early = await call('/api/auth/login', {
      method: 'POST',
      body: { email: signupEmail, password },
      ip: ipA,
    });
    check(
      'signing in with those credentials still fails',
      early.status === 401,
      `${early.status} ${errCode(early)}`,
    );

    const wrong = await call('/api/auth/signup/verify', {
      method: 'POST',
      body: { challengeId: signupBody.challengeId, code: '000000' },
      ip: ipA,
    });
    check('wrong code → 400 OTP_INVALID', errCode(wrong) === 'OTP_INVALID', `${wrong.status} ${errCode(wrong)}`);

    const afterWrong = await prisma.user.findUnique({ where: { email: signupEmail } });
    check('still NO user row after a wrong code', afterWrong === null);

    const verifyJar = jar();
    const okRes = await call('/api/auth/signup/verify', {
      method: 'POST',
      body: { challengeId: signupBody.challengeId, code: signupBody.devCode },
      jar: verifyJar,
      ip: ipA,
    });
    check('correct code → 201', okRes.status === 201, `got ${okRes.status} ${okRes.raw.slice(0, 120)}`);
    check('sets a session cookie', !!verifyJar.get('avo_session'));

    const createdUser = await prisma.user.findUnique({ where: { email: signupEmail } });
    check('user row now exists', createdUser !== null);
    check('account is born verified', !!createdUser?.emailVerifiedAt);
    if (createdUser) created.push(createdUser.id);

    const replay = await call('/api/auth/signup/verify', {
      method: 'POST',
      body: { challengeId: signupBody.challengeId, code: signupBody.devCode },
      ip: ipA,
    });
    check('replaying the same code → OTP_USED', errCode(replay) === 'OTP_USED', errCode(replay) ?? '');

    // ══ Flow B — manager creates a member ══════════════════════════════════
    console.log('\n══ Flow B: manager adds a member via that member\'s OTP ══');
    const ipB = IP(20);
    const managerJar = await login('manager@avomessage.demo', 'Manager123!', ipB);

    const companiesRes = await call('/api/companies', { jar: managerJar, ip: ipB });
    // `ok()` returns the payload raw, so this endpoint answers with a bare
    // array. Accept a wrapped shape too, so the probe survives a refactor of the
    // envelope rather than silently reporting "no companies".
    const raw = companiesRes.json as unknown;
    const rows = (Array.isArray(raw)
      ? raw
      : ((raw as { items?: unknown[] }).items ?? (raw as { data?: unknown[] }).data ?? [])) as Array<{
      company?: { id: string; slug?: string; name: string };
      id?: string;
      slug?: string;
      name?: string;
      role?: string;
    }>;
    const flat = rows.map((r) => ({ ...(r.company ?? {}), role: r.role, id: r.company?.id ?? r.id }));
    const picked = flat.find((c) => c.slug === 'avocado-labs') ?? flat[0];
    const companyId = picked?.id;
    if (!companyId) {
      throw new Error(
        `manager has no company to test against (status ${companiesRes.status}, body ${companiesRes.raw.slice(0, 200)})`,
      );
    }
    console.log(`  (company: ${picked?.name ?? 'unknown'} ${companyId})`);

    const memberEmail = `otp_member_${s}@example.com`;
    const memberUsername = `otp_mem_${s}`.slice(0, 24);

    const mReq = await call(`/api/companies/${companyId}/members/otp`, {
      method: 'POST',
      body: { name: 'Otp Member', username: memberUsername, email: memberEmail, password },
      jar: managerJar,
      ip: ipB,
    });
    const mBody = mReq.json as { challengeId?: string; devCode?: string };
    check('POST .../members/otp → 200', mReq.status === 200, `got ${mReq.status} ${mReq.raw.slice(0, 160)}`);
    checkDevCode('returns devCode (log mailer only)', mBody.devCode);

    const mBefore = await prisma.user.findUnique({ where: { email: memberEmail } });
    check('NO member user row yet', mBefore === null);

    const mVerify = await call('/api/otp/verify', {
      method: 'POST',
      body: { challengeId: mBody.challengeId, code: mBody.devCode },
      jar: managerJar,
      ip: ipB,
    });
    check('verify → 201', mVerify.status === 201, `got ${mVerify.status} ${mVerify.raw.slice(0, 160)}`);

    const memberUser = await prisma.user.findUnique({ where: { email: memberEmail } });
    check('member user row created', memberUser !== null);
    if (memberUser) {
      created.push(memberUser.id);
      const membership = await prisma.companyMember.findUnique({
        where: { companyId_userId: { companyId, userId: memberUser.id } },
      });
      check('membership created with role MEMBER', membership?.role === 'MEMBER', membership?.role ?? 'none');
    }

    // ══ Flow C — admin creates a manager ═══════════════════════════════════
    console.log('\n══ Flow C: admin adds a manager via that manager\'s OTP ══');
    const ipC = IP(30);
    const adminJar = await login('admin@avomessage.demo', 'Admin123!', ipC);

    const mgrEmail = `otp_manager_${s}@example.com`;
    const mgrUsername = `otp_mgr_${s}`.slice(0, 24);

    const gReq = await call(`/api/admin/managers/${companyId}/members/otp`, {
      method: 'POST',
      body: { name: 'Otp Manager', username: mgrUsername, email: mgrEmail, password },
      jar: adminJar,
      ip: ipC,
    });
    const gBody = gReq.json as { challengeId?: string; devCode?: string };
    check('POST admin .../members/otp → 200', gReq.status === 200, `got ${gReq.status} ${gReq.raw.slice(0, 160)}`);
    checkDevCode('returns devCode (log mailer only)', gBody.devCode);

    const gBefore = await prisma.user.findUnique({ where: { email: mgrEmail } });
    check('NO manager user row yet', gBefore === null);

    const gVerify = await call('/api/otp/verify', {
      method: 'POST',
      body: { challengeId: gBody.challengeId, code: gBody.devCode },
      jar: adminJar,
      ip: ipC,
    });
    check('verify → 201', gVerify.status === 201, `got ${gVerify.status} ${gVerify.raw.slice(0, 160)}`);

    const mgrUser = await prisma.user.findUnique({ where: { email: mgrEmail } });
    check('manager user row created', mgrUser !== null);
    if (mgrUser) {
      created.push(mgrUser.id);
      const membership = await prisma.companyMember.findUnique({
        where: { companyId_userId: { companyId, userId: mgrUser.id } },
      });
      check('membership created with role MANAGER', membership?.role === 'MANAGER', membership?.role ?? 'none');
    }

    // ══ Cross-flow authority ═══════════════════════════════════════════════
    console.log('\n══ Authority: the manager endpoint is not a back door to MANAGER ══');
    const ipD = IP(40);

    const asManager = await call(`/api/companies/${companyId}/members/otp`, {
      method: 'POST',
      body: { name: 'Sneaky', username: `sneak_${s}`.slice(0, 24), email: `sneak_${s}@example.com`, password },
      jar: managerJar,
      ip: ipD,
    });
    check(
      'a manager CAN request a member OTP (that is the point)',
      asManager.status === 200,
      `${asManager.status}`,
    );

    const mgrTriesAdmin = await call(`/api/admin/managers/${companyId}/members/otp`, {
      method: 'POST',
      body: { name: 'Sneaky', username: `sneak2_${s}`.slice(0, 24), email: `sneak2_${s}@example.com`, password },
      jar: managerJar,
      ip: ipD,
    });
    check(
      'a manager CANNOT reach the admin manager endpoint',
      mgrTriesAdmin.status === 403,
      `${mgrTriesAdmin.status} ${errCode(mgrTriesAdmin)}`,
    );

    const anonVerify = await call('/api/otp/verify', {
      method: 'POST',
      body: { challengeId: gBody.challengeId, code: gBody.devCode },
      ip: ipD,
    });
    // 403 CSRF_INVALID is the expected answer, and it arrives from the proxy
    // before the route runs: an anonymous POST carries no double-submit pair.
    // Either rejection is fine — what matters is that it is not a 201.
    check(
      'an anonymous caller cannot redeem an authenticated challenge',
      anonVerify.status === 403 || anonVerify.status === 401,
      `${anonVerify.status} ${errCode(anonVerify)}`,
    );

    const anonSignupDoor = await call('/api/otp/verify', {
      method: 'POST',
      body: { challengeId: signupBody.challengeId, code: signupBody.devCode },
      jar: managerJar,
      ip: ipD,
    });
    check(
      'a SIGNUP challenge is refused at the authenticated door',
      errCode(anonSignupDoor) === 'OTP_INVALID',
      `${anonSignupDoor.status} ${errCode(anonSignupDoor)}`,
    );

    // ══ Defences ═══════════════════════════════════════════════════════════
    //
    // These are per-challenge and per-address, so they are independent of the
    // per-IP limiter — and each group below still claims its own address, so a
    // failure here can only ever mean the defence under test, never a spent
    // budget.
    console.log('\n══ Defences: resend cooldown, attempt cap, expiry ══');

    const ipE = IP(50);
    const guardEmail = `otp_guard_${s}@example.com`;
    const guardUser = `otp_grd_${s}`.slice(0, 24);
    const guardReq = await call('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Otp Guard', username: guardUser, email: guardEmail, password },
      ip: ipE,
    });
    const guardBody = guardReq.json as { challengeId?: string; devCode?: string };
    check('guard challenge issued', guardReq.status === 202, `got ${guardReq.status}`);

    const resend = await call('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Otp Guard', username: guardUser, email: guardEmail, password },
      ip: ipE,
    });
    check(
      'immediate resend → 429 OTP_RESEND_TOO_SOON',
      errCode(resend) === 'OTP_RESEND_TOO_SOON',
      `${resend.status} ${errCode(resend)}`,
    );

    // The attempt cap needs 5 wrong guesses plus the correct one — exactly the
    // 6-request budget the `otp` preset allows per address, so it gets its own.
    const ipF = IP(60);
    let lastCode = '';
    let capHit = false;
    for (let i = 0; i < 6; i++) {
      const guess = String(100000 + i).padStart(6, '0');
      const attempt = await call('/api/auth/signup/verify', {
        method: 'POST',
        body: { challengeId: guardBody.challengeId, code: guess },
        ip: ipF,
      });
      lastCode = errCode(attempt) ?? '';
      if (lastCode === 'OTP_ATTEMPTS_EXCEEDED') {
        capHit = true;
        console.log(`  (attempt cap reached on guess #${i + 1})`);
        break;
      }
    }
    check('the attempt cap is reached within 6 wrong guesses', capHit, `last code: ${lastCode}`);

    const afterCap = await call('/api/auth/signup/verify', {
      method: 'POST',
      body: { challengeId: guardBody.challengeId, code: guardBody.devCode },
      ip: ipF,
    });
    check(
      'even the CORRECT code is refused once the cap is hit',
      errCode(afterCap) === 'OTP_ATTEMPTS_EXCEEDED',
      `${afterCap.status} ${errCode(afterCap)}`,
    );

    const guardUserRow = await prisma.user.findUnique({ where: { email: guardEmail } });
    check('no account was created by the failed attempts', guardUserRow === null);

    // Expiry: age the challenge past its TTL directly, which is the only way to
    // test a 10-minute window without waiting ten minutes.
    const ipG = IP(70);
    const expireEmail = `otp_expire_${s}@example.com`;
    const expireReq = await call('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Otp Expire', username: `otp_exp_${s}`.slice(0, 24), email: expireEmail, password },
      ip: ipG,
    });
    const expireBody = expireReq.json as { challengeId?: string; devCode?: string };
    await prisma.otpChallenge.update({
      where: { id: expireBody.challengeId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await call('/api/auth/signup/verify', {
      method: 'POST',
      body: { challengeId: expireBody.challengeId, code: expireBody.devCode },
      ip: ipG,
    });
    check('an expired code → OTP_EXPIRED', errCode(expired) === 'OTP_EXPIRED', `${expired.status} ${errCode(expired)}`);

    const mismatch = await call('/api/otp/verify', {
      method: 'POST',
      body: { challengeId: 'not-a-real-challenge-id', code: '123456' },
      jar: managerJar,
      ip: ipG,
    });
    check(
      'an unknown challenge id is refused indistinguishably',
      errCode(mismatch) === 'OTP_INVALID',
      `${mismatch.status} ${errCode(mismatch)}`,
    );

    // ══ The per-IP limiter itself ══════════════════════════════════════════
    //
    // Run with the limiter ON, this is the section that could not exist while
    // the script was being run with RATE_LIMIT_DISABLED=1. Seven cheap requests
    // (bogus challenge ids — no mail is sent) from one address: the `otp` preset
    // is 6/min, so the sixth is served and the seventh is refused.
    console.log('\n══ Per-IP rate limit: 6/min on the otp preset ══');
    const ipH = IP(80);
    const codes: Array<string | null> = [];
    for (let i = 0; i < 7; i++) {
      const r = await call('/api/otp/verify', {
        method: 'POST',
        body: { challengeId: `ck-nonexistent-${i}`, code: '123456' },
        jar: managerJar,
        ip: ipH,
      });
      codes.push(errCode(r));
    }
    check(
      'the first six requests from one address are served',
      codes.slice(0, 6).every((c) => c === 'OTP_INVALID'),
      codes.slice(0, 6).join(','),
    );
    check(
      'the seventh is refused with 429 RATE_LIMITED',
      codes[6] === 'RATE_LIMITED',
      `got ${codes[6]}`,
    );

    // And a different address is unaffected — the bucket is per-IP, not global.
    const elsewhere = await call('/api/otp/verify', {
      method: 'POST',
      body: { challengeId: 'ck-nonexistent-other', code: '123456' },
      jar: managerJar,
      ip: IP(81),
    });
    check(
      'a different address is not affected by that budget',
      errCode(elsewhere) === 'OTP_INVALID',
      `got ${elsewhere.status} ${errCode(elsewhere)}`,
    );

    // ── cleanup ────────────────────────────────────────────────────────────
    console.log('\n── cleanup ──');
    if (created.length > 0) {
      await prisma.companyMember.deleteMany({ where: { userId: { in: created } } });
      await prisma.session.deleteMany({ where: { userId: { in: created } } });
      await prisma.notification.deleteMany({ where: { userId: { in: created } } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: created } } });
      await prisma.loginActivity.deleteMany({ where: { userId: { in: created } } });
      await prisma.user.deleteMany({ where: { id: { in: created } } });
      console.log(`  removed ${created.length} probe user(s)`);
    }
    await prisma.otpChallenge.deleteMany({
      where: { email: { contains: s } },
    });
  } finally {
    const { prisma } = await import('../lib/db');
    await prisma.$disconnect();
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
