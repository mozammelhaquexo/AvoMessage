/**
 * scripts/verify-company-create-gate.mjs
 *
 * Proves, against the RUNNING dev server over real HTTP, that:
 *
 *   1. a plain user cannot create a company — `POST /api/companies` answers
 *      403 `COMPANY_CREATE_FORBIDDEN`;
 *   2. the /companies page does not offer them the button, and the Bengali
 *      "you have not been added to a company" state is what ships instead;
 *   3. /companies/new refuses them too (the URL is typeable, so the gate has to
 *      be there as well as on the button);
 *   4. a manager — reached the way the product reaches one, by applying and
 *      being approved — CAN create a company;
 *   5. an administrator can as well.
 *
 * ── Why the manager is made by applying, not by writing a row ─────────────
 *
 * Because that is the path a real person takes, and it is the path most likely
 * to be broken: approval with no company attached grants no company role, so if
 * the tier were derived from company roles alone the approved manager would be
 * permanently unable to create the company the approval told them to create.
 * Step 4 is that deadlock's regression test, live.
 *
 * ── What it leaves behind ─────────────────────────────────────────────────
 *
 * One `probe_*` user plus the company they create. Both are swept by
 * `scripts/cleanup-probe-data.ts` (the email prefix is in PROBE_PREFIXES, and
 * the company is owned by that user) — run it afterwards.
 *
 * ── Requirements ──────────────────────────────────────────────────────────
 *
 *   MAILER_DRIVER=log npm run dev
 *
 * The signup code is read from the JSON response, which only carries it when
 * the mailer is the log driver (see `devCodeFor` in lib/services/otp.ts).
 *
 * Run:  node scripts/verify-company-create-gate.mjs [baseUrl]
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

// ─── tiny cookie jar ────────────────────────────────────────────────────────

class Jar {
  constructor() {
    this.cookies = new Map();
  }
  absorb(res) {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const h of raw) {
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

// ─── accounts ───────────────────────────────────────────────────────────────

const ACCOUNTS = {
  manager: { email: 'manager@avomessage.demo', password: 'Manager123!' },
  admin: { email: 'admin@avomessage.demo', password: 'Admin123!' },
};

async function login(account) {
  const jar = new Jar();
  // Prime the CSRF cookie pair.
  await req(jar, '/login');
  const res = await req(jar, '/api/auth/login', {
    method: 'POST',
    body: { email: account.email, password: account.password },
  });
  if (!res.ok) {
    throw new Error(`login ${account.email} → ${res.status} ${await res.text()}`);
  }
  return jar;
}

/** Sign up a brand-new, verified user through the real two-step OTP flow. */
async function signupProbeUser(prefix) {
  const jar = new Jar();
  await req(jar, '/login');
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const creds = {
    name: `Probe ${stamp}`,
    username: `${prefix}_${stamp}`.slice(0, 24),
    email: `${prefix}_${stamp}@example.com`.toLowerCase(),
    password: 'correct-horse-8',
  };

  const asked = await req(jar, '/api/auth/register', { method: 'POST', body: creds, csrf: false });
  const challenge = await json(asked);
  if (asked.status !== 202 || !challenge?.devCode) {
    throw new Error(
      `register → ${asked.status}. No devCode in the response — is the dev server ` +
        `running with MAILER_DRIVER=log? (MAILER_DRIVER=log npm run dev)`,
    );
  }

  const verified = await req(jar, '/api/auth/signup/verify', {
    method: 'POST',
    body: { challengeId: challenge.challengeId, code: challenge.devCode },
    csrf: false,
  });
  if (!verified.ok) {
    throw new Error(`signup/verify → ${verified.status} ${await verified.text()}`);
  }
  return { jar, creds };
}

/** `POST /api/companies`, returning the status and error code. */
async function createCompany(jar, name) {
  const res = await req(jar, '/api/companies', { method: 'POST', body: { name } });
  const body = await json(res);
  return { status: res.status, code: body?.error?.code ?? null, id: body?.company?.id ?? null };
}

/** The server-rendered HTML of a page. */
async function pageHtml(jar, path) {
  const res = await req(jar, path);
  return { status: res.status, html: await res.text() };
}

/**
 * The visible text of a rendered document.
 *
 * Substring checks against raw HTML are unreliable in two ways that matter
 * here: React separates adjacent text expressions with `<!-- -->` (so
 * `{current} of {limit}` ships as `0<!-- --> of <!-- -->1`), and class names are
 * arbitrary strings. The assertions below read the text for that reason, and the
 * raw HTML only when the claim is about an attribute.
 */
function text(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── the run ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nCompany create gate — live probe against ${BASE}\n`);

  // ── 1. a plain user ───────────────────────────────────────────────────────
  console.log('a plain user');
  const user = await signupProbeUser('probe_gate');

  const denied = await createCompany(user.jar, `Probe Denied Co ${Date.now().toString(36)}`);
  check(
    'POST /api/companies is refused with 403 COMPANY_CREATE_FORBIDDEN',
    denied.status === 403 && denied.code === 'COMPANY_CREATE_FORBIDDEN',
    `status=${denied.status} code=${denied.code}`,
  );

  const dir = await pageHtml(user.jar, '/companies');
  check('/companies answers 200', dir.status === 200, `status=${dir.status}`);
  check(
    '/companies ships no "New company" button to a user',
    !text(dir.html).includes('New company'),
  );
  check(
    '/companies ships no link to /companies/new to a user',
    !dir.html.includes('/companies/new'),
  );
  check(
    '/companies states the cap — "0 of 1 company"',
    text(dir.html).includes('0 of 1 company'),
    text(dir.html).match(/\d+ of \d+ compan\w+/)?.[0] ?? 'no cap line found',
  );
  check(
    '/companies rendered its shell (search box present)',
    dir.html.includes('Search companies'),
  );

  const newPage = await pageHtml(user.jar, '/companies/new');
  check('/companies/new answers 200', newPage.status === 200, `status=${newPage.status}`);
  check(
    '/companies/new refuses a user instead of showing the form',
    !newPage.html.includes('Company name') && !newPage.html.includes('URL slug'),
  );
  check(
    '/companies/new explains why, in Bengali',
    newPage.html.includes('কোম্পানি'),
    'found the Bengali refusal copy',
  );
  check(
    '/companies/new points at the manager — and at the application form',
    text(newPage.html).includes('ম্যানেজার') && newPage.html.includes('/settings/manager/apply'),
  );
  check(
    '/companies/new does not offer the create form’s submit button',
    !text(newPage.html).includes('Create company'),
  );

  // ── 2. the manager path: apply, then be approved ───────────────────────────
  console.log('\nan applicant, approved with no company (the product path)');
  const applicant = await signupProbeUser('probe_mgr');

  const beforeApproval = await createCompany(
    applicant.jar,
    `Probe Early Co ${Date.now().toString(36)}`,
  );
  check(
    'an unapproved applicant still cannot create a company',
    beforeApproval.status === 403 && beforeApproval.code === 'COMPANY_CREATE_FORBIDDEN',
    `status=${beforeApproval.status} code=${beforeApproval.code}`,
  );

  const submitted = await req(applicant.jar, '/api/manager-applications', {
    method: 'POST',
    body: {
      companyName: `Probe Own Co ${Date.now().toString(36)}`,
      position: 'Head of Ops',
      companySize: 10,
      teamCount: 2,
      teamSize: 5,
      message: 'Live probe: I would like to run my own company.',
    },
  });
  const application = await json(submitted);
  check('the application is accepted', submitted.status === 201, `status=${submitted.status}`);

  const admin = await login(ACCOUNTS.admin);
  const approved = await req(
    admin,
    `/api/admin/manager-applications/${application.id}`,
    { method: 'POST', body: { action: 'APPROVE' } },
  );
  const decision = await json(approved);
  check(
    'an admin approves it with no company attached',
    approved.status === 200 && decision?.companyId === null,
    `status=${approved.status} companyId=${decision?.companyId}`,
  );

  const allowed = await createCompany(applicant.jar, `Probe Approved Co ${Date.now().toString(36)}`);
  check(
    'the approved manager CAN now create the company the approval told them to create',
    allowed.status === 201,
    `status=${allowed.status}${allowed.code ? ` code=${allowed.code}` : ''}`,
  );

  // ── 3. the admin ──────────────────────────────────────────────────────────
  console.log('\nan administrator');
  const adminDir = await pageHtml(admin, '/companies');
  check(
    '/companies ships the "New company" button to an admin',
    text(adminDir.html).includes('New company'),
  );
  check(
    '/companies shows no cap to an admin — there is none',
    !/\d+ of \d+ compan/.test(text(adminDir.html)),
  );
  const adminNew = await pageHtml(admin, '/companies/new');
  check(
    '/companies/new shows the form to an admin',
    adminNew.html.includes('Company name') && adminNew.html.includes('URL slug'),
  );

  // ── 4. the seeded manager (a company role, no application) ────────────────
  console.log('\nthe seeded manager');
  const manager = await login(ACCOUNTS.manager);
  const mgrDir = await pageHtml(manager, '/companies');
  check(
    '/companies ships the "New company" button to a manager',
    text(mgrDir.html).includes('New company'),
  );
  check(
    '/companies shows the manager cap — "N of 3 companies"',
    text(mgrDir.html).includes('of 3 companies'),
    text(mgrDir.html).match(/\d+ of \d+ compan\w+/)?.[0] ?? 'no cap line found',
  );
  const mgrNew = await pageHtml(manager, '/companies/new');
  check('/companies/new shows the form to a manager', mgrNew.html.includes('Company name'));

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
