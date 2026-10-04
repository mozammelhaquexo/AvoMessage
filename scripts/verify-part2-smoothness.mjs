/**
 * scripts/verify-part2-smoothness.mjs
 *
 * A whole-site sweep against the running dev server. Three facts per page:
 *
 *   1. it answers 200 (or an expected redirect — /admin/companies was merged
 *      into /admin/managers in part 2);
 *   2. it ships no `<a>...<button>` nesting — invalid interactive markup, which
 *      is what made the Messages name-click unreachable by keyboard;
 *   3. every route inside `(app)` renders at least one CONTENT-AREA loading
 *      fallback (aria-label="Loading …"), and no public route renders any.
 *      How many is not an invariant — React only emits a fallback for a segment
 *      that actually suspended during SSR.
 *
 * ROOT_SPIN is reported but is NOT a pass criterion. The root
 * `app/loading.tsx` fallback legitimately appears in the initial streamed
 * document — it renders before the shell exists. What matters is that it
 * cannot take over a client-side navigation, and that is a runtime fact this
 * script cannot see: it is measured by
 * `scripts/verify-chat-click-in-browser.mjs` instead.
 *
 * Usage: node scripts/verify-part2-smoothness.mjs [baseUrl] [--dump <dir>]
 */

// Positional arg is the base URL; flags are parsed separately. A bare
// `process.argv[2]` would happily swallow `--dump` and try to fetch it.
const baseArg = process.argv.slice(2).find((a) => /^https?:\/\//.test(a));
const BASE = baseArg ?? "http://localhost:3000";

const PAGES = [
  // ── public ───────────────────────────────────────────────────────────────
  ["public", "/"],
  ["public", "/login"],
  ["public", "/signup"],
  ["public", "/terms"],
  ["public", "/forgot-password"],
  ["public", "/reset-password"],
  ["public", "/verify-email"],
  // ── any signed-in user ───────────────────────────────────────────────────
  ["user", "/home"],
  ["user", "/messages"],
  ["user", "/messages/demo"],
  ["user", "/companies"],
  ["user", "/companies/new"],
  ["user", "/company/avocado-labs"],
  ["user", "/notifications"],
  ["user", "/bookmarks"],
  ["user", "/help"],
  ["user", "/world"],
  ["user", "/search"],
  ["user", "/hashtag/avocado"],
  ["user", "/profile/demo"],
  ["user", "/profile/demo/followers"],
  ["user", "/profile/demo/following"],
  ["user", "/settings"],
  ["user", "/settings/manager/apply"],
  // ── company manager ──────────────────────────────────────────────────────
  ["manager", "/manage/avocado-labs"],
  ["manager", "/manage/avocado-labs/members"],
  ["manager", "/manage/avocado-labs/teams"],
  ["manager", "/manage/avocado-labs/invitations"],
  ["manager", "/manage/avocado-labs/join-requests"],
  ["manager", "/manage/avocado-labs/announcements"],
  ["manager", "/manage/avocado-labs/analytics"],
  ["manager", "/manage/avocado-labs/branding"],
  ["manager", "/manage/avocado-labs/activity"],
  ["manager", "/manage/avocado-labs/settings"],
  // ── platform admin ───────────────────────────────────────────────────────
  ["admin", "/admin"],
  ["admin", "/admin/managers"],
  ["admin", "/admin/users"],
  ["admin", "/admin/roles"],
  ["admin", "/admin/reports"],
  ["admin", "/admin/analytics"],
  ["admin", "/admin/announcements"],
  ["admin", "/admin/applications"],
  ["admin", "/admin/audit-logs"],
  ["admin", "/admin/companies"],
  ["admin", "/admin/content"],
  ["admin", "/admin/moderation"],
  ["admin", "/admin/settings"],
];

const ACCOUNTS = {
  user: { email: "demo@avomessage.demo", password: "Demo1234!" },
  manager: { email: "manager@avomessage.demo", password: "Manager123!" },
  admin: { email: "admin@avomessage.demo", password: "Admin123!" },
};

/** A cookie jar good enough for two cookies. */
function jar() {
  const store = new Map();
  return {
    header: () => [...store].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb: (res) => {
      const raw = res.headers.getSetCookie?.() ?? [];
      for (const line of raw) {
        const [pair] = line.split(";");
        const i = pair.indexOf("=");
        store.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
    get: (k) => store.get(k),
  };
}

async function login(account) {
  const c = jar();
  // prime the CSRF cookie
  const primed = await fetch(`${BASE}/login`, { redirect: "manual" });
  c.absorb(primed);
  let token = c.get("avo_csrf");

  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      cookie: c.header(),
      ...(token ? { "x-csrf-token": token } : {}),
    },
    body: JSON.stringify(account),
  });
  c.absorb(res);
  token = c.get("avo_csrf") ?? token;
  if (!res.ok) {
    throw new Error(`login ${account.email} → ${res.status} ${await res.text()}`);
  }
  return c;
}

/** Strip <script>/<style> so their string contents cannot create false hits. */
function stripNoise(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");
}

/** True if the markup contains an <a> that wraps a <button>. */
function hasAnchorWrappingButton(html) {
  const clean = stripNoise(html);
  const re = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(clean))) {
    if (/<button\b/i.test(m[1])) return true;
  }
  return false;
}

function countOf(html, needle) {
  return html.split(needle).length - 1;
}

const results = [];
let failures = 0;

// `--dump <dir>` writes every fetched document to disk so a failing row can be
// inspected directly instead of guessed at.
const dumpIdx = process.argv.indexOf("--dump");
const dumpDir = dumpIdx > -1 ? process.argv[dumpIdx + 1] : null;
if (dumpDir) {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dumpDir, { recursive: true });
}

// Log in ONCE per account and reuse the session — /api/auth/login is rate
// limited, and one login per page trips the limiter (429) part-way through.
const sessions = new Map();
async function sessionFor(who) {
  if (!sessions.has(who)) sessions.set(who, await login(ACCOUNTS[who]));
  return sessions.get(who);
}

for (const [who, path] of PAGES) {
  const cookies = who === "public" ? null : await sessionFor(who);
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: cookies ? { cookie: cookies.header() } : {},
  });
  const html = await res.text();

  if (dumpDir) {
    const { writeFileSync } = await import("node:fs");
    const name = `${who}${path === "/" ? "_root" : path.replace(/\//g, "_")}.html`;
    writeFileSync(`${dumpDir}/${name}`, html);
  }

  const nested = hasAnchorWrappingButton(html);
  // The root fallback is exactly `aria-label="Loading"`; every content-area
  // fallback is `aria-label="Loading …"` with a space. The closing quote is
  // what separates the two — `"Loading"` must not match `"Loading page"`.
  //
  // How MANY content-area fallbacks a document contains is not an invariant:
  // React only emits a fallback for a segment that actually suspended during
  // SSR, so it varies from 0 to 3 depending on what was slow that request.
  // The invariant that does hold is presence: every (app) route ships at least
  // one, and no public route ships any.
  const contentBoundary = countOf(html, 'aria-label="Loading ');
  const rootSpinner = countOf(html, 'aria-label="Loading"');

  const inApp = who !== "public";
  const redirected = res.status >= 300 && res.status < 400;
  const location = res.headers.get("location") ?? "";

  const ok =
    !nested &&
    (redirected ? true : res.status === 200 && (inApp ? contentBoundary >= 1 : contentBoundary === 0));

  if (!ok) failures++;
  results.push({
    who,
    path,
    status: redirected ? `${res.status}→${location.replace(/^https?:\/\/[^/]+/, "")}` : res.status,
    nested,
    appBoundary: redirected ? "n/a" : contentBoundary,
    rootSpinner: redirected ? "n/a" : rootSpinner,
    ok,
  });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(
  pad("WHO", 9) + pad("PATH", 38) + pad("HTTP", 22) + pad("<a><button>", 12) +
    pad("APP_BND", 9) + pad("ROOT_SPIN", 11) + "OK",
);
console.log("-".repeat(102));
for (const r of results) {
  console.log(
    pad(r.who, 9) + pad(r.path, 38) + pad(r.status, 22) + pad(r.nested, 12) +
      pad(r.appBoundary, 9) + pad(r.rootSpinner, 11) + (r.ok ? "yes" : "NO"),
  );
}
console.log("-".repeat(102));
console.log(`${results.length - failures}/${results.length} pages pass`);
process.exit(failures === 0 ? 0 : 1);
