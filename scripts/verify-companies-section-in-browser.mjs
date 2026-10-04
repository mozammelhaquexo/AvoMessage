/**
 * scripts/verify-companies-section-in-browser.mjs
 *
 * Proves, in a real Chrome over the DevTools Protocol, the two product rules
 * that were just changed:
 *
 *   1. THE "NOT IN A COMPANY YET" STATE LIVES ON /companies AND NOWHERE ELSE.
 *      A plain user (USER tier, no company) sees the Bengali card on
 *      /companies, and must NOT see it on /home. Before this change Home
 *      rendered the same card through `HomeCompanySection`.
 *   2. THE COMPANY POST FEED ON /companies IS FULLY INTERACTIVE. Once the user
 *      is in a company with a post, /companies shows the post body AND the
 *      like / comment / repost / share controls; /home shows none of it.
 *
 * Why a browser and not a test: `/home` and `/companies` are client components
 * that fetch after hydration, so the company content is absent from the SSR
 * HTML in BOTH the old and the new code. A server-rendered assertion cannot
 * tell them apart — only a hydrated DOM can.
 *
 * Why a throwaway user: the platform administrator (ADMIN tier) may create a
 * company, so `companiesEmptyKind` sends them the "Create a company" prompt and
 * they never see the Bengali card. The rule is about a plain USER, so the
 * script makes one.
 *
 * Everything it creates is deleted again in a `finally` — the account, the
 * company, the membership and the post. It writes nothing it does not remove,
 * and it never touches the administrator's own account.
 *
 * Run against a live dev server:   npx tsx scripts/verify-companies-section-in-browser.mjs
 */

import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv.slice(2).find((a) => /^https?:\/\//.test(a)) ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.AVO_ADMIN_EMAIL ?? "mozammelhaquexo@gmail.com";

const LOG = join(tmpdir(), "avo-cdp-companies.log");
writeFileSync(LOG, "");

function say(line) {
  appendFileSync(LOG, `${line}\n`);
  console.log(line);
}

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    say(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    say(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const BN_EMPTY = "আপনাকে এখনো কোনো কোম্পানিতে যোগ করা হয়নি";
const FEED_HEADING = "Posts from your companies";
const POST_BODY = "PROBE-FEED-VERIFY — this company post must be visible and interactive.";
const stamp = Date.now();

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// tsx does not read `.env` on its own — the dev server does, and the other
// scripts in here (dbstat.mjs, reset-single-admin.ts) load it the same way.
// Without this, the first Prisma query throws "The database is not configured"
// (lib/db builds its client lazily, so merely importing it is harmless now).
const envPath = join(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
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

// ── fixtures, created straight through Prisma ───────────────────────────────
// Creating the rows directly (rather than through the API) is deliberate: it
// means the teardown knows EXACTLY which rows exist, so nothing is left behind
// and nothing of the administrator's is touched.
const { prisma } = await import("../lib/db");
const { hashPassword } = await import("../lib/auth/password");

const probeEmail = `probe_feed_${stamp}@example.com`;
const probeUsername = `probe_feed_${stamp}`;
const probePassword = `ProbeFeed${stamp}!a`;
const companySlug = `probe-feed-${stamp}`;

const created = { userId: null, companyId: null, postId: null, adminId: null };

async function teardown() {
  try {
    if (created.postId) await prisma.post.deleteMany({ where: { id: created.postId } });
    if (created.companyId) {
      await prisma.post.deleteMany({ where: { companyId: created.companyId } });
      await prisma.companyMember.deleteMany({ where: { companyId: created.companyId } });
      await prisma.conversation.deleteMany({ where: { companyId: created.companyId } });
      await prisma.company.deleteMany({ where: { id: created.companyId } });
    }
    if (created.userId) {
      await prisma.session.deleteMany({ where: { userId: created.userId } });
      await prisma.userPresence.deleteMany({ where: { userId: created.userId } });
      await prisma.loginActivity.deleteMany({ where: { userId: created.userId } });
      await prisma.auditLog.deleteMany({ where: { actorId: created.userId } });
      await prisma.companyMember.deleteMany({ where: { userId: created.userId } });
      await prisma.user.deleteMany({ where: { id: created.userId } });
    }
  } catch (e) {
    say(`  ! teardown warning: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
if (!admin) {
  say(`FATAL: no account for ${ADMIN_EMAIL} — is the dev database running and seeded?`);
  process.exit(2);
}
created.adminId = admin.id;

const probe = await prisma.user.create({
  data: {
    email: probeEmail,
    name: "Feed Probe",
    username: probeUsername,
    passwordHash: await hashPassword(probePassword),
    emailVerifiedAt: new Date(),
    platformRole: "USER",
    presence: { create: { status: "OFFLINE" } },
  },
});
created.userId = probe.id;
say(`probe user : ${probeEmail} (USER tier, no company)`);

// ── launch a throwaway Chrome ───────────────────────────────────────────────
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  say("FATAL: no Chrome/Edge binary found");
  await teardown();
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), "avo-cdp-companies-profile-"));
say(`chrome     : ${chromePath}`);

const child = spawn(
  chromePath,
  [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--window-size=1440,900",
    "about:blank",
  ],
  { detached: true, stdio: "ignore" },
);
child.unref();

const portFile = join(profile, "DevToolsActivePort");
let port = null;
let browserWsPath = "/devtools/browser";
for (let i = 0; i < 120; i++) {
  if (existsSync(portFile)) {
    const txt = readFileSync(portFile, "utf8").split("\n").map((s) => s.trim());
    if (txt[0]) {
      port = Number(txt[0]);
      if (txt[1]) browserWsPath = txt[1];
      break;
    }
  }
  await sleep(100);
}
if (!port) {
  say("FATAL: DevToolsActivePort never appeared");
  await teardown();
  process.exit(2);
}
say(`devtools   : 127.0.0.1:${port}`);

// ── a very small CDP client (same shape as verify-otp-ui-in-browser.mjs) ────
class Cdp {
  #ws;
  #id = 0;
  #pending = new Map();
  #listeners = new Map();

  static async connect(url) {
    const c = new Cdp();
    c.#ws = new WebSocket(url);
    await new Promise((res, rej) => {
      c.#ws.addEventListener("open", res, { once: true });
      c.#ws.addEventListener("error", () => rej(new Error(`ws ${url} handshake failed`)), {
        once: true,
      });
    });
    c.#ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = c.#pending.get(msg.id);
        c.#pending.delete(msg.id);
        if (!p) return;
        if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
        else p.res(msg.result);
        return;
      }
      for (const fn of c.#listeners.get(msg.method) ?? []) fn(msg.params);
    });
    return c;
  }

  send(method, params = {}, sessionId) {
    const id = ++this.#id;
    return new Promise((res, rej) => {
      this.#pending.set(id, { res, rej });
      this.#ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(method, fn) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, []);
    this.#listeners.get(method).push(fn);
  }

  close() {
    this.#ws.close();
  }
}

const browser = await Cdp.connect(`ws://127.0.0.1:${port}${browserWsPath}`);
const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => browser.send(m, p, sessionId);

await S("Page.enable");
await S("Runtime.enable");

const consoleErrors = [];
browser.on("Runtime.consoleAPICalled", (p) => {
  if (p.type === "error") {
    consoleErrors.push((p.args ?? []).map((a) => a.value ?? a.description ?? "").join(" "));
  }
});

const evaluate = async (expression, awaitPromise = false) => {
  const r = await S("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
  }
  return r.result.value;
};

const waitFor = async (expr, label, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expr)) return true;
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${label}`);
};

const goto = async (path) => {
  await S("Page.navigate", { url: `${BASE}${path}` });
  await waitFor(
    `document.readyState === "complete" && location.pathname !== "about:blank"`,
    `load ${path}`,
  );
  await sleep(500); // let hydration settle
};

const bodyText = () => evaluate("document.body.innerText");

try {
  // ── log in as the plain user ──────────────────────────────────────────────
  await goto("/login");
  const loginStatus = await evaluate(
    `fetch("/api/auth/login", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify(${JSON.stringify({ email: probeEmail, password: probePassword })}),
     }).then((r) => r.status)`,
    true,
  );
  check("probe user can sign in", loginStatus === 200, `POST /api/auth/login → ${loginStatus}`);

  // ── RULE 1: the Bengali state is on /companies … ─────────────────────────
  say("\nRULE 1 — the 'not in a company yet' card belongs to Companies only");
  await goto("/companies");
  let onCompanies = false;
  try {
    await waitFor(`document.body.innerText.includes(${JSON.stringify(BN_EMPTY)})`, "Bengali card");
    onCompanies = true;
  } catch {
    onCompanies = false;
  }
  check("/companies shows the Bengali 'not added to a company' card", onCompanies);

  // ── … and NOT on /home ───────────────────────────────────────────────────
  await goto("/home");
  // Wait for the public feed to have rendered, so "absent" is a real absence
  // and not just "the page had not hydrated yet".
  await waitFor(
    `document.body.innerText.includes("It's quiet here") || document.querySelectorAll("article").length > 0`,
    "home feed to render",
  );
  await sleep(1500); // give any company fetch time to land, as the old code did
  const homeText = await bodyText();
  check("/home does NOT show the Bengali card", !homeText.includes(BN_EMPTY));
  check("/home does NOT show a company feed heading", !homeText.includes(FEED_HEADING));

  // ── RULE 2: the /companies feed is interactive ───────────────────────────
  say("\nRULE 2 — the /companies post feed renders full PostCards");
  const company = await prisma.company.create({
    data: { name: "Probe Feed Co", slug: companySlug, ownerId: admin.id },
  });
  created.companyId = company.id;
  await prisma.companyMember.create({
    data: { companyId: company.id, userId: admin.id, role: "OWNER" },
  });
  await prisma.companyMember.create({
    data: { companyId: company.id, userId: probe.id, role: "MEMBER" },
  });
  const post = await prisma.post.create({
    data: {
      authorId: admin.id,
      body: POST_BODY,
      visibility: "COMPANY",
      companyId: company.id,
    },
  });
  created.postId = post.id;
  say(`  fixture: company "${company.name}" + 1 company post`);

  await goto("/companies");
  let feedShown = false;
  try {
    await waitFor(
      `document.body.innerText.includes(${JSON.stringify(POST_BODY)})`,
      "company post in the feed",
    );
    feedShown = true;
  } catch {
    feedShown = false;
  }
  check("/companies shows the company post", feedShown);

  const actions = await evaluate(`
    Array.from(document.querySelectorAll('[role="group"][aria-label="Post actions"] [aria-label]'))
      .map((e) => e.getAttribute("aria-label"))
      .join(" | ")
  `);
  check("post has a like control", /Like post|Unlike post/.test(actions ?? ""), actions ?? "");
  check("post has a comment control", /View comments/.test(actions ?? ""));
  check("post has a share control", /Copy link to post/.test(actions ?? ""));
  check("post has a repost control", /Repost/.test(actions ?? ""));

  // ── and Home still shows none of it ──────────────────────────────────────
  await goto("/home");
  await waitFor(
    `document.body.innerText.includes("It's quiet here") || document.querySelectorAll("article").length > 0`,
    "home feed to render",
  );
  await sleep(1500);
  const homeAfter = await bodyText();
  check("/home does NOT show the company post", !homeAfter.includes(POST_BODY));
  check("/home does NOT show the company feed heading", !homeAfter.includes(FEED_HEADING));

  // ── console hygiene ──────────────────────────────────────────────────────
  const realErrors = consoleErrors.filter(
    (e) => !/Failed to load resource|favicon|WebSocket/i.test(e),
  );
  check("no unexpected console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" / "));
} catch (e) {
  fail++;
  say(`  ✗ harness error: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  say("\ntearing down fixtures…");
  await teardown();
  browser.close();
  try {
    process.kill(-child.pid);
  } catch {
    /* already gone */
  }
  await prisma.$disconnect();
}

say(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
