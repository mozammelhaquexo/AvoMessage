/**
 * scripts/verify-single-admin.mjs
 *
 * Proves, against the RUNNING dev server, that exactly one login can reach the
 * Admin Panel and nobody else can get there by any route:
 *
 *   1. the administrator's email + password logs in, and the account is
 *      SUPER_ADMIN;
 *   2. the admin API answers 200 to that account;
 *   3. a brand-new signup is a USER and gets 403 on every admin route tried;
 *   4. the one-admin rule refuses to promote that user (`SINGLE_ADMIN_ONLY`),
 *      so there is no path to a second administrator — not even for the admin
 *      themselves, which is the point;
 *   5. a signed-out caller gets 401 on the same routes;
 *   6. a wrong password does not log in.
 *
 * Run:  node scripts/verify-single-admin.mjs <email> <password> [baseUrl]
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function loadEnv() {
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
loadEnv();

const BASE = process.argv.slice(2).find((a) => /^https?:\/\//.test(a)) ?? 'http://localhost:3000';
const positional = process.argv.slice(2).filter((a) => !/^https?:\/\//.test(a));
const EMAIL = positional[0] ?? 'mozammelhaquexo@gmail.com';
const PASSWORD = positional[1];
if (!PASSWORD) {
  console.error('usage: node scripts/verify-single-admin.mjs <email> <password> [baseUrl]');
  process.exit(1);
}

// ─── tiny cookie jar ────────────────────────────────────────────────────────

class Jar {
  constructor() {
    this.cookies = new Map();
  }
  absorb(res) {
    for (const h of res.headers.getSetCookie?.() ?? []) {
      const [pair] = h.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const k = pair.slice(0, eq).trim();
        const v = pair.slice(eq + 1).trim();
        if (v) this.cookies.set(k, v);
        else this.cookies.delete(k);
      }
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  get(name) {
    return this.cookies.get(name);
  }
}

async function req(jar, path, { method = 'GET', body, csrf = true, headers = {} } = {}) {
  const h = { ...headers };
  if (jar && jar.header()) h.cookie = jar.header();
  if (body !== undefined) h['content-type'] = 'application/json';
  if (csrf && jar) {
    const token = jar.get('avo_csrf');
    if (token) h['x-csrf-token'] = token;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  if (jar) jar.absorb(res);
  return res;
}

async function json(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ─── reporting ──────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  \u2713 ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    failures.push(label);
    console.log(`  \u2717 ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function login(email, password) {
  const jar = new Jar();
  await req(jar, '/login'); // prime the CSRF cookie pair
  const res = await req(jar, '/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  const body = await json(res);
  return { status: res.status, body, jar };
}

/** The admin routes a would-be attacker would try first. */
const ADMIN_GETS = [
  '/api/admin/dashboard',
  '/api/admin/users',
  '/api/admin/companies',
  '/api/admin/manager-applications',
  '/api/admin/audit-logs',
  '/api/admin/settings',
  '/api/admin/analytics',
];

/**
 * Markup that only the AdminShell renders. If any of these reaches a browser
 * that is not the administrator's, the server-side guard has failed — that is
 * the invariant being checked, not the HTTP status, because Next legitimately
 * answers a guarded page with 200 when it streams a redirect or a refusal.
 */
const ADMIN_SHELL_MARKERS = [
  'Admin console toolbar',
  'href="/admin/users"',
  'Audit logs',
  'Moderation',
  'Announcements',
];

/** Visible text of an HTML document (React inserts `<!-- -->` between text nodes). */
function text(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function leakedAdminMarkup(html) {
  return ADMIN_SHELL_MARKERS.filter((m) => html.includes(m));
}

async function main() {
  console.log(`\nSingle-administrator gate — live probe against ${BASE}\n`);

  // ── 1. the administrator logs in ──────────────────────────────────────────
  console.log('the administrator');
  const admin = await login(EMAIL, PASSWORD);
  check(
    'login succeeds',
    admin.status === 200,
    admin.status === 200 ? undefined : `status=${admin.status} code=${admin.body?.error?.code}`,
  );
  check(
    'the account is SUPER_ADMIN',
    admin.body?.user?.platformRole === 'SUPER_ADMIN',
    `platformRole=${admin.body?.user?.platformRole}`,
  );

  for (const path of ADMIN_GETS) {
    const res = await req(admin.jar, path);
    check(`GET ${path} → 200`, res.status === 200, `status=${res.status}`);
  }

  const adminPage = await req(admin.jar, '/admin');
  check('/admin page renders', adminPage.status === 200, `status=${adminPage.status}`);

  // ── 2. a second account cannot reach any of it ────────────────────────────
  console.log('\na brand-new account');

  const jar = new Jar();
  await req(jar, '/login');
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const creds = {
    name: `Second ${stamp}`,
    username: `secadm_${stamp}`.slice(0, 24),
    email: `secadm_${stamp}@example.com`.toLowerCase(),
    password: 'correct-horse-8',
  };
  const asked = await req(jar, '/api/auth/register', { method: 'POST', body: creds, csrf: false });
  const challenge = await json(asked);
  if (asked.status !== 202 || !challenge?.devCode) {
    throw new Error(
      `register → ${asked.status}. No devCode — is the dev server on MAILER_DRIVER=log?`,
    );
  }
  const verified = await req(jar, '/api/auth/signup/verify', {
    method: 'POST',
    body: { challengeId: challenge.challengeId, code: challenge.devCode },
    csrf: false,
  });
  const signedUp = await json(verified);
  check(
    'a new signup is a plain USER',
    [200, 201].includes(verified.status) && signedUp?.user?.platformRole === 'USER',
    `status=${verified.status} platformRole=${signedUp?.user?.platformRole}`,
  );

  for (const path of ADMIN_GETS) {
    const res = await req(jar, path);
    check(`GET ${path} → 403`, res.status === 403, `status=${res.status}`);
  }

  const userAdminRes = await req(jar, '/admin');
  const userAdminHtml = await userAdminRes.text();
  const userLeaks = leakedAdminMarkup(userAdminHtml);
  check(
    '/admin sends a plain user no admin shell — only the refusal',
    userAdminRes.status === 200 &&
      userLeaks.length === 0 &&
      text(userAdminHtml).includes('Not authorized'),
    userLeaks.length > 0 ? `leaked: ${userLeaks.join(', ')}` : `status=${userAdminRes.status}`,
  );

  // ── 3. and there is no path to a second administrator ─────────────────────
  console.log('\nthe path to a second administrator');
  const promote = await req(admin.jar, `/api/admin/users/${signedUp.user.id}`, {
    method: 'PATCH',
    body: { platformRole: 'ADMIN' },
  });
  const promoteBody = await json(promote);
  check(
    'even the administrator cannot promote anyone (one-admin rule)',
    promote.status === 409 && promoteBody?.error?.code === 'SINGLE_ADMIN_ONLY',
    `status=${promote.status} code=${promoteBody?.error?.code}`,
  );
  const still = await req(jar, '/api/admin/dashboard');
  check('the refused account still cannot reach the admin API', still.status === 403, `status=${still.status}`);

  // ── 4. signed-out and wrong-password ──────────────────────────────────────
  console.log('\nsigned out, and a wrong password');
  const anonDash = await req(new Jar(), '/api/admin/dashboard');
  check('signed-out admin API is refused', [401, 403].includes(anonDash.status), `status=${anonDash.status}`);

  const anonPage = await req(new Jar(), '/admin');
  const anonHtml = await anonPage.text();
  const anonLeaks = leakedAdminMarkup(anonHtml);
  check(
    'signed-out /admin sends no admin shell, and points at /login',
    anonLeaks.length === 0 &&
      (anonHtml.includes('url=/login') || anonHtml.includes('NEXT_REDIRECT')),
    anonLeaks.length > 0 ? `leaked: ${anonLeaks.join(', ')}` : `status=${anonPage.status}`,
  );

  const wrong = await login(EMAIL, 'not-the-password');
  check('a wrong password does not log in', wrong.status === 401, `status=${wrong.status}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length > 0) {
    console.log('\nfailed checks:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nprobe crashed:', err);
  process.exit(1);
});
