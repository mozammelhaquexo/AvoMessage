/**
 * scripts/verify-otp-ui-in-browser.mjs
 *
 * Drives the three OTP flows through the real UI in a real Chrome, over the
 * DevTools Protocol, and reads the result out of the live DOM.
 *
 * Why this exists alongside scripts/verify-otp-flows.ts: that script proves the
 * SERVER gate (no user row before a correct code). It says nothing about
 * whether a person can actually get through the screens — whether the code
 * field takes six digits, whether the last digit submits, whether the dialog
 * stays open long enough to finish. A server test passes just as happily
 * against a form that never submits.
 *
 * What is driven, end to end, clicking the way a user does:
 *
 *   1. /signup        form → code panel → verify → lands signed in on /
 *   2. /manage/…/members   "Add member" dialog → code panel → member in the table
 *   3. /admin/managers/…   "Add manager" dialog → code panel → manager listed
 *
 * The code is read out of the email the server actually sent (see MAIL_DIR
 * below), which is also how the harness asserts the code is NOT on the page.
 * Nothing is stubbed: the same HTTP requests, the same CSRF handling, the same
 * React state.
 *
 * Requires the log mailer, since a real driver puts the message beyond reach of
 * the filesystem:  MAILER_DRIVER=log npm run dev
 *
 * The browser is pinned to one simulated client address so it does not share a
 * rate-limit bucket with scripts/verify-otp-flows.ts. Nothing is written
 * outside a throwaway Chrome profile in the OS temp dir.
 *
 * Usage: node scripts/verify-otp-ui-in-browser.mjs [baseUrl]
 */

import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Positional arg is the base URL; flags are parsed separately. A bare
// `process.argv[2]` would happily swallow a flag and try to fetch it.
const baseArg = process.argv.slice(2).find((a) => /^https?:\/\//.test(a));
const BASE = baseArg ?? "http://localhost:3000";
const LOG = join(tmpdir(), "avo-cdp-otp.log");
writeFileSync(LOG, "");

function say(line) {
  // Redirected stdout is block-buffered; the file survives a kill.
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

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. launch a throwaway Chrome ────────────────────────────────────────────
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  say("FATAL: no Chrome/Edge binary found");
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), "avo-cdp-otp-profile-"));
say(`chrome   : ${chromePath}`);
say(`profile  : ${profile}`);

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

// DevToolsActivePort holds "<port>\n<browser ws path>". The path is the browser
// endpoint INCLUDING its GUID — "/devtools/browser" without it is a 404, which
// surfaces as a bare WebSocket handshake abort with no useful message.
const portFile = join(profile, "DevToolsActivePort");
let port = null;
let browserWsPath = "/devtools/browser";
for (let i = 0; i < 100; i++) {
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
  process.exit(2);
}
say(`devtools : 127.0.0.1:${port}${browserWsPath}`);

// ── 2. a very small CDP client ──────────────────────────────────────────────
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
      c.#ws.addEventListener(
        "error",
        (ev) => rej(new Error(`ws ${url} → ${ev.message ?? "handshake failed"}`)),
        { once: true },
      );
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
      for (const fn of c.#listeners.get(msg.method) ?? []) fn(msg.params, msg.sessionId);
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
await S("Network.enable");

// Give this browser its own rate-limit bucket, so it cannot spend the budget
// that scripts/verify-otp-flows.ts relies on (or vice versa).
//
// The last octet is random per run: the bucket lives for 60 s, and a second run
// started within that window would otherwise inherit the first run's spend and
// report a genuine-looking failure that is really just the limiter working.
// `198.51.100.0/24` is TEST-NET-2, reserved for documentation.
const BROWSER_IP = `198.51.100.${200 + Math.floor(Math.random() * 50)}`;
say(`client ip: ${BROWSER_IP} (simulated, x-forwarded-for)`);
await S("Network.setExtraHTTPHeaders", { headers: { "x-forwarded-for": BROWSER_IP } });

// Console errors are surfaced: a React error during an OTP flow would otherwise
// only show up as "the button did nothing".
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

const waitFor = async (expr, label, timeoutMs = 25000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expr)) return true;
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${label}`);
};

const goto = async (url) => {
  await S("Page.navigate", { url });
  await waitFor(
    `document.readyState === "complete" && location.pathname !== "about:blank"`,
    `load ${url}`,
  );
  await sleep(700); // let hydration settle
};

/**
 * Set a React-controlled input's value through the native setter, then fire the
 * events React listens for. Assigning `.value` directly is swallowed: React's
 * value tracker sees no change and never re-renders.
 */
const FILL = `(sel, value, index = 0) => {
  const els = [...document.querySelectorAll(sel)];
  const el = els[index];
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const desc = Object.getOwnPropertyDescriptor(proto.prototype, "value");
  desc.set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}`;

const fill = (sel, value, index = 0) =>
  evaluate(`(${FILL})(${JSON.stringify(sel)}, ${JSON.stringify(value)}, ${index})`);

/** Click an element by its visible text, through the real input pipeline. */
const clickText = async (text, tag = "button") => {
  const box = await evaluate(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(tag)})];
    const el = els.find((e) => (e.textContent || "").includes(${JSON.stringify(text)}));
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
    };
  })()`);
  if (!box) throw new Error(`no ${tag} containing "${text}"`);
  if (box.disabled) throw new Error(`"${text}" is disabled`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await S("Input.dispatchMouseEvent", {
      type,
      x: Math.round(box.x),
      y: Math.round(box.y),
      button: "left",
      clickCount: 1,
    });
  }
  await sleep(120);
};

/**
 * The code travels by email and nowhere else, so this reads it out of the mail
 * the server actually produced.
 *
 * That replaced a "tap to fill" button the panel used to render in
 * development. Reading the rendered email is the stronger check of the two: it
 * proves the code the *recipient* gets is the code the server accepts, rather
 * than merely that some code was echoed back to the page.
 *
 * The cost is a dependency on the log mailer — with a real driver (smtp /
 * resend) the message leaves the machine and there is nothing local to read.
 * Run the server as `MAILER_DRIVER=log npm run dev`; the failure message below
 * says so rather than timing out silently.
 */
const MAIL_DIR = join(process.cwd(), "storage", "mail");

const mailSnapshot = () => {
  try {
    return new Set(readdirSync(MAIL_DIR).filter((f) => f.includes("-otp-") && f.endsWith(".html")));
  } catch {
    return new Set();
  }
};

/** The six digits, read from the element the email renders them in. */
const codeFromMail = (file) => {
  const html = readFileSync(join(MAIL_DIR, file), "utf8");
  const inner = /<div class="avo-code[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  const code = inner.trim();
  if (!/^\d{6}$/.test(code)) throw new Error(`no 6-digit code in ${file}`);
  return code;
};

/** Wait for a mail file that was not there before, and return its code. */
const waitForEmailedCode = async (before, label, timeoutMs = 25000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const f of mailSnapshot()) {
      if (!before.has(f)) return { code: codeFromMail(f), file: f };
    }
    await sleep(150);
  }
  throw new Error(
    `no new OTP email appeared in ${MAIL_DIR} for ${label}.\n` +
      `This harness reads the code out of the mail, so it needs the log mailer:\n` +
      `  MAILER_DRIVER=log npm run dev`,
  );
};

/**
 * Type digits into the boxes one at a time, the way a person's keys arrive.
 * The last digit completes the code, and the field submits itself — that is the
 * component's own behaviour, not a shortcut taken here.
 */
const typeDigits = async (code, count = code.length) => {
  for (let i = 0; i < count; i++) await fill('[role="group"] input', code[i], i);
  await sleep(150);
};

/** What the six code boxes currently hold, joined. */
const codeBoxValue = () =>
  evaluate(`(() => {
    const boxes = [...document.querySelectorAll('[role="group"] input')];
    if (boxes.length === 0) return "";
    return boxes.map((b) => b.value).join("");
  })()`);

const logout = async () => {
  const status = await evaluate(
    `(async () => {
      const m = document.cookie.match(/(?:^|;\\s*)avo_csrf=([^;]+)/);
      const r = await fetch("/api/auth/logout", {
        method: "POST",
        headers: m ? { "x-csrf-token": decodeURIComponent(m[1]) } : {},
      });
      return r.status;
    })()`,
    true,
  );
  await sleep(200);
  return status;
};

const login = async (email, password) => {
  await goto(`${BASE}/login`);
  await fill('input[type="email"], input[name="email"]', email);
  await fill('input[type="password"], input[name="password"]', password);
  await clickText("Log in");
  await waitFor(`!location.pathname.startsWith("/login")`, "login redirect", 20000);
  await sleep(600);
  return evaluate(`location.pathname`);
};

const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

// ── 3. the three flows ──────────────────────────────────────────────────────
const s = stamp();
const password = "correct-horse-8";
const signupUser = `uiprobe_${s}`.slice(0, 24);
const signupEmail = `uiprobe_${s}@example.com`;
const memberUser = `uimem_${s}`.slice(0, 24);
const memberEmail = `uimem_${s}@example.com`;
const mgrUser = `uimgr_${s}`.slice(0, 24);
const mgrEmail = `uimgr_${s}@example.com`;

try {
  // ══ Flow A — public signup ═══════════════════════════════════════════════
  say("\n══ Flow A: /signup — form, then the code panel ══");
  await goto(`${BASE}/signup`);
  check("signup form rendered", await evaluate(`!!document.querySelector('input[autocomplete="name"]')`));

  await fill('input[autocomplete="name"]', "UI Probe");
  await fill('input[autocomplete="username"]', signupUser);
  await fill('input[autocomplete="email"]', signupEmail);
  await fill('input[autocomplete="new-password"]', password, 0);
  await fill('input[autocomplete="new-password"]', password, 1);
  // The terms box is a hard gate on the client.
  await evaluate(`(() => {
    const cb = document.querySelector('input[type="checkbox"]');
    if (cb && !cb.checked) cb.click();
    return cb ? cb.checked : false;
  })()`);

  const beforeSignupMail = mailSnapshot();
  await clickText("Create account");

  await waitFor(
    `!!document.body.textContent.includes("Confirm your email address")`,
    "the code panel",
    25000,
  );
  check("submitting the form moves to the code panel", true);
  check(
    "the panel names the address the code went to",
    await evaluate(`document.body.textContent.includes(${JSON.stringify(signupEmail)})`),
  );

  const boxCount = await evaluate(`document.querySelectorAll('[role="group"] input').length`);
  check("the code field has six boxes", boxCount === 6, `${boxCount} boxes`);
  check(
    "each box is labelled for a screen reader",
    await evaluate(`!!document.querySelector('[aria-label="Digit 1 of 6"]')`),
  );

  const { code: signupCode, file: signupMail } = await waitForEmailedCode(beforeSignupMail, "signup");
  check("the code arrives by email", /^\d{6}$/.test(signupCode), `${signupCode} (${signupMail})`);
  check(
    "the code appears nowhere on the page — the inbox is the only place",
    !(await evaluate(`document.body.textContent.includes(${JSON.stringify(signupCode)})`)),
  );

  // Five digits must not be enough: the field only submits once it is complete.
  await typeDigits(signupCode, 5);
  check("five digits fill five boxes", (await codeBoxValue()).length === 5, await codeBoxValue());
  check("the panel is still open, unsubmitted", await evaluate(`location.pathname === "/signup"`));

  await typeDigits(signupCode);
  await waitFor(`location.pathname === "/"`, "redirect to home after verify", 25000);
  await sleep(800);
  check("a correct code signs the new account in and lands on /", true, await evaluate(`location.pathname`));

  const sessionUser = await evaluate(
    `fetch("/api/auth/me").then((r) => r.json()).then((d) => d.user ? d.user.username : null)`,
    true,
  );
  check("the session belongs to the account just created", sessionUser === signupUser, `${sessionUser}`);

  // ══ Flow B — manager adds a member ══════════════════════════════════════
  say("\n══ Flow B: /manage/…/members — Add member ══");
  check("logout before switching accounts", (await logout()) === 200);
  await login("manager@avomessage.demo", "Manager123!");
  await goto(`${BASE}/manage/avocado-labs/members`);
  await waitFor(
    `!![...document.querySelectorAll("button")].find((b) => b.textContent.includes("Add member"))`,
    "the Add member button",
  );
  check("the member page offers 'Add member' (not a temp-password form)", true);

  await clickText("Add member");
  await waitFor(`!!document.querySelector('[role="dialog"]')`, "the add-member dialog");
  const dialogInputCount = await evaluate(`document.querySelectorAll('[role="dialog"] input').length`);
  check("the dialog asks for name, username, email and password", dialogInputCount === 4, `${dialogInputCount} fields`);

  await evaluate(`(() => {
    const i = document.querySelectorAll('[role="dialog"] input');
    const set = (el, v) => {
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      d.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set(i[0], "UI Member");
    set(i[1], ${JSON.stringify(memberUser)});
    set(i[2], ${JSON.stringify(memberEmail)});
    set(i[3], ${JSON.stringify(password)});
    return true;
  })()`);
  const beforeMemberMail = mailSnapshot();
  await clickText("Send code");
  await waitFor(
    `!!document.body.textContent.includes("Confirm the member")`,
    "the member code panel",
  );
  check("sending the code switches the dialog to step 2", true);

  const { code: memberCode } = await waitForEmailedCode(beforeMemberMail, "the member");
  check("the member code arrives by email", /^\d{6}$/.test(memberCode), memberCode);
  await typeDigits(memberCode);
  await waitFor(
    `!document.querySelector('[role="dialog"]')`,
    "the dialog to close after verify",
  );
  check("a correct code closes the dialog", true);

  await sleep(1200); // let the member list reload
  check(
    "the new member is in the directory",
    await evaluate(`document.body.textContent.includes("UI Member")`),
  );

  // ══ Flow C — admin adds a manager ═══════════════════════════════════════
  say("\n══ Flow C: /admin/managers — Add manager ══");
  check("logout before switching accounts", (await logout()) === 200);
  await login("admin@avomessage.demo", "Admin123!");

  // Reach the company through the real navigation, so the URL under test is the
  // one the UI produces rather than one this script guessed.
  await goto(`${BASE}/admin/managers`);
  await clickText("Avocado Labs", "a");
  await waitFor(`/^\\/admin\\/managers\\/cm/.test(location.pathname)`, "the company detail page");
  const detailPath = await evaluate(`location.pathname`);
  say(`  (company detail: ${detailPath})`);
  check("clicking a company opens its manager detail page", /^\/admin\/managers\/cm/.test(detailPath));

  // The URL changes on the client before the company fetch resolves — the page
  // is still showing "Loading company…" at this point. Wait for the CONTROL,
  // not the route, or the click lands on a skeleton.
  await waitFor(
    `!![...document.querySelectorAll("button")].find((b) => b.textContent.includes("Add manager"))`,
    "the Add manager button",
  );
  check("the company detail page loaded and offers 'Add manager'", true);

  await clickText("Add manager");
  await waitFor(`!!document.querySelector('[role="dialog"]')`, "the add-manager dialog");
  await evaluate(`(() => {
    const i = document.querySelectorAll('[role="dialog"] input');
    const set = (el, v) => {
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      d.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set(i[0], "UI Manager");
    set(i[1], ${JSON.stringify(mgrUser)});
    set(i[2], ${JSON.stringify(mgrEmail)});
    set(i[3], ${JSON.stringify(password)});
    return true;
  })()`);
  const beforeMgrMail = mailSnapshot();
  await clickText("Send code");
  await waitFor(
    `!!document.body.textContent.includes("Confirm the manager")`,
    "the manager code panel",
  );
  check("sending the code switches the dialog to step 2", true);

  const { code: mgrCode } = await waitForEmailedCode(beforeMgrMail, "the manager");
  check("the manager code arrives by email", /^\d{6}$/.test(mgrCode), mgrCode);
  await typeDigits(mgrCode);
  await waitFor(`!document.querySelector('[role="dialog"]')`, "the dialog to close after verify");
  check("a correct code closes the dialog", true);

  await sleep(1200);
  check(
    "the new manager is listed under Managers",
    await evaluate(`document.body.textContent.includes("UI Manager")`),
  );

  // ══ Console hygiene ═════════════════════════════════════════════════════
  say("\n══ Browser console ══");
  const realErrors = consoleErrors.filter(
    (e) => !/Download the React DevTools|Fast Refresh/i.test(e),
  );
  check("no console errors during the three flows", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
} catch (e) {
  fail++;
  say(`\n✗ FATAL: ${e instanceof Error ? e.message : String(e)}`);
  try {
    say(`  url: ${await evaluate(`location.href`)}`);
    // The dialog first: a failed step-1 POST reports itself as an inline
    // paragraph inside it, which the page-level text below would bury.
    const dialog = await evaluate(
      `(() => {
        const d = document.querySelector('[role="dialog"]');
        return d ? d.innerText.replace(/\\n+/g, " / ").slice(0, 600) : null;
      })()`,
    );
    if (dialog) say(`  dialog: ${dialog}`);
    say(`  text: ${String(await evaluate(`document.body.innerText.slice(0, 700)`)).replace(/\n+/g, " / ")}`);
  } catch {
    /* the page may already be gone */
  }
} finally {
  browser.close();
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

say(`\n${"─".repeat(60)}`);
say(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
