/**
 * scripts/verify-chat-click-in-browser.mjs
 *
 * The part-2 complaint (#38) was a VISIBLE glitch:
 *
 *   "Messages section e user er name er upore click dile glitch er moton lage"
 *
 * A source-level test can only prove the markup is shaped right. This harness
 * answers the actual question — does the app shell survive the click? — by
 * driving a real Chrome over the DevTools Protocol, clicking the way a user
 * does (Input.dispatchMouseEvent, through the real event pipeline), and reading
 * the live DOM.
 *
 * The falsifiable claim:
 *
 *   The <aside aria-label="Primary navigation"> that exists BEFORE the click is
 *   still there AFTER the click — the same DOM node, still carrying a sentinel
 *   attribute this harness put on it. If the root loading boundary ever took
 *   over, React would have created a brand-new aside (sentinel gone) and the
 *   whole-window spinner would have entered the document at least once.
 *
 * Three things are recorded, none of which the source can tell us:
 *   1. shellSentinelSurvived  — boolean, read from the live DOM
 *   2. rootSpinnerAppearances — count, from a MutationObserver armed before the
 *                               click (so nothing can slip past between polls)
 *   3. appSkeletonAppearances — count, same observer (the CONTENT-AREA boundary)
 *
 * Plus the network timeline: was there a prefetch for the target route BEFORE
 * the click? That is what makes the navigation instant in the first place.
 *
 * Nothing is written outside a throwaway Chrome profile in the OS temp dir.
 *
 * Usage: node scripts/verify-chat-click-in-browser.mjs [baseUrl]
 */

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Positional arg is the base URL; flags are parsed separately. A bare
// `process.argv[2]` would happily swallow `--delay-rsc` and try to fetch it.
const baseArg = process.argv.slice(2).find((a) => /^https?:\/\//.test(a));
const BASE = baseArg ?? "http://localhost:3000";
const LOG = join(tmpdir(), "avo-cdp-click.log");
writeFileSync(LOG, "");

function say(line) {
  // Redirected stdout is block-buffered; the file survives a kill. (Skill trap.)
  appendFileSync(LOG, `${line}\n`);
  console.log(line);
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

const profile = mkdtempSync(join(tmpdir(), "avo-cdp-profile-"));
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

// Network timeline — proves the prefetch happens before the click.
const requests = [];
browser.on("Network.requestWillBeSent", (p) => {
  requests.push({ t: Date.now(), url: p.request.url, type: p.type });
});

// `--delay-rsc <ms>` holds every client-navigation RSC response back, which is
// the ONLY way to make this harness discriminate. On localhost a navigation
// resolves in ~170 ms and the Suspense fallback is never rendered at all — so
// the check passes whether or not a loading boundary exists, and proves
// nothing. With the response held, the fallback is guaranteed to render, and
// then the question "did the shell survive it?" has a real answer.
const delayIdx = process.argv.indexOf("--delay-rsc");
const delayRsc = delayIdx > -1 ? Number(process.argv[delayIdx + 1]) : 0;

if (delayRsc > 0) {
  await S("Fetch.enable", { patterns: [{ urlPattern: "*_rsc=*", requestStage: "Request" }] });
  browser.on("Fetch.requestPaused", ({ requestId }, sid) => {
    setTimeout(() => {
      browser.send("Fetch.continueRequest", { requestId }, sid).catch(() => {});
    }, delayRsc);
  });
  say(`slowdown : RSC responses held ${delayRsc} ms`);
}

const evaluate = async (expression, awaitPromise = false) => {
  const r = await S("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
  });
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

const goto = async (url) => {
  await S("Page.navigate", { url });
  await waitFor(
    `document.readyState === "complete" && location.pathname !== "about:blank"`,
    `load ${url}`,
  );
  await sleep(600); // let hydration settle
};

// ── 3. sign in through the real form ────────────────────────────────────────
await goto(`${BASE}/login`);

await evaluate(`(() => {
  const setNative = (el, v) => {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
    desc.set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const email = document.querySelector('input[type="email"], input[name="email"]');
  const pass  = document.querySelector('input[type="password"], input[name="password"]');
  if (!email || !pass) return "no-form";
  setNative(email, "demo@avomessage.demo");
  setNative(pass, "Demo1234!");
  return "filled";
})()`);

await evaluate(`(() => {
  const form = document.querySelector("form");
  if (!form) return "no-form";
  form.requestSubmit ? form.requestSubmit() : form.submit();
  return "submitted";
})()`);

await waitFor(`location.pathname !== "/login"`, "login redirect", 25000);
say(`login    : ok → ${await evaluate("location.pathname")}`);

// ── 4. go to Messages and find a person to click ────────────────────────────
await goto(`${BASE}/messages`);
await waitFor(
  `document.querySelector('aside[aria-label="Primary navigation"]') !== null`,
  "app shell",
);
// Give the router idle time to run its viewport prefetch, so "0 requests before
// the click" is a real finding rather than a stopwatch artefact.
await sleep(3000);

const target = await evaluate(`(() => {
  // The DM rows in the conversation list link to /profile/<username>.
  const links = [...document.querySelectorAll('a[href^="/profile/"]')];
  const pick = links.find((a) => a.textContent && a.textContent.trim().length > 0);
  if (!pick) return null;
  const r = pick.getBoundingClientRect();
  return {
    href: pick.getAttribute("href"),
    text: (pick.textContent || "").trim().slice(0, 40),
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
    w: Math.round(r.width),
    h: Math.round(r.height),
  };
})()`);

if (!target || target.w === 0) {
  say("SKIP: no /profile/ link rendered in the conversation list");
  say(`(visible links: ${await evaluate(
    `JSON.stringify([...document.querySelectorAll("a")].slice(0, 30).map(a => a.getAttribute("href")))`,
  )})`);
  browser.close();
  process.exit(3);
}
say(`target   : <a href="${target.href}"> "${target.text}" at ${target.x},${target.y} (${target.w}x${target.h})`);

// ── 5. helpers: arm the observer, mark the shell, click like a user ─────────
//
// The shell sentinel is set ONCE and never re-set: if any navigation unmounts
// the app shell, React builds a fresh <aside> and the attribute is simply gone.
// Re-marking between steps would hide exactly the thing we are measuring.
const SHELL_TOKEN = `t${Date.now().toString(36)}`;

const armProbe = () =>
  evaluate(`(() => {
    window.__probe = { rootSpinner: 0, appSkeleton: 0, hardLoad: false };
    if (window.__probeMo) window.__probeMo.disconnect();
    const classify = (node) => {
      if (node.nodeType !== 1) return;
      for (const el of [node, ...node.querySelectorAll("*")]) {
        const l = el.getAttribute && el.getAttribute("aria-label");
        if (l === "Loading") window.__probe.rootSpinner++;
        if (l === "Loading page") window.__probe.appSkeleton++;
      }
    };
    const mo = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) classify(n);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.__probeMo = mo;
    return true;
  })()`);

const markShell = (token) =>
  evaluate(`(() => {
    const a = document.querySelector('aside[aria-label="Primary navigation"]');
    if (!a) return false;
    a.setAttribute("data-probe-shell", ${JSON.stringify(token)});
    return true;
  })()`);

/** Click through the real event pipeline at the centre of a selector's box. */
const clickSelector = async (selector) => {
  const rect = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!rect) return null;
  await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y, button: "none" });
  await S("Input.dispatchMouseEvent", {
    type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1,
  });
  await S("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1,
  });
  return rect;
};

const readBack = () =>
  evaluate(`(() => {
    const a = document.querySelector('aside[aria-label="Primary navigation"]');
    return {
      path: location.pathname,
      asidePresent: !!a,
      sentinel: a ? a.getAttribute("data-probe-shell") : null,
      probe: window.__probe ?? null,
    };
  })()`);

// ── 6. phase 1 — the reported glitch: click a person's name in Messages ─────
await markShell(SHELL_TOKEN);
await armProbe();

const t0 = Date.now();
const pathBefore = await evaluate("location.pathname");
const prefetchHints = await evaluate(`(() => {
  const links = [...document.querySelectorAll('link[rel="prefetch"], link[rel="preload"][as="fetch"]')];
  return links.map((l) => l.getAttribute("href")).filter(Boolean).slice(0, 6);
})()`);

await clickSelector('a[href="' + target.href + '"]');
await waitFor(
  `location.pathname !== ${JSON.stringify(pathBefore)}`,
  "route change",
  15000 + delayRsc,
);
const clickToRouteMs = Date.now() - t0;
await sleep(1200 + delayRsc); // let the destination paint

const after = await readBack();

const tClick = t0;
const profileReqs = requests.filter((r) => r.url.includes("/profile/"));
const prefetchedBeforeClick = profileReqs.filter((r) => r.t < tClick).length;
const afterClick = profileReqs.filter((r) => r.t >= tClick).length;
const rscBefore = requests.filter((r) => r.url.includes("_rsc=") && r.t < tClick).length;
const rscAfter = requests.filter((r) => r.url.includes("_rsc=") && r.t >= tClick).length;

const shellSurvived = after.asidePresent && after.sentinel === SHELL_TOKEN;
const rootSpinnerAppeared = (after.probe?.rootSpinner ?? -1) > 0;

say("");
say("── phase 1: click a person's name in Messages ──────────────");
say(`route            : ${pathBefore}  →  ${after.path}`);
say(`click→route      : ${clickToRouteMs} ms`);
say(`shell node kept  : ${shellSurvived}  (sentinel=${after.sentinel})`);
say(`root spinner     : ${after.probe?.rootSpinner} appearance(s)  (must be 0)`);
say(`(app) skeleton   : ${after.probe?.appSkeleton} appearance(s)`);
say(`/profile/ reqs   : ${prefetchedBeforeClick} before click, ${afterClick} after`);
say(`RSC (_rsc=) reqs : ${rscBefore} before click, ${rscAfter} after`);
say(`prefetch hints   : ${prefetchHints.length ? prefetchHints.join(", ") : "(none in the DOM)"}`);
for (const r of profileReqs.slice(0, 4)) {
  say(`   ${r.t < tClick ? "pre-click " : "post-click"} ${r.type.padEnd(8)} ${r.url.slice(0, 100)}`);
}

// ── 7. phase 2 — sweep every sidebar destination, same two questions ───────
const NAV = ["/home", "/messages", "/notifications", "/companies", "/settings", "/help"];
const sweep = [];

// Start from a known page so the first hop is a real navigation too.
await goto(`${BASE}/home`);
await waitFor(
  `document.querySelector('aside[aria-label="Primary navigation"]') !== null`,
  "app shell (sweep)",
);
await sleep(800);
await markShell(SHELL_TOKEN);

for (const href of NAV) {
  const here = await evaluate("location.pathname");
  if (here === href) continue;

  await armProbe();
  const t = Date.now();
  const clicked = await clickSelector(`nav[aria-label="Main"] a[href="${href}"]`);
  if (!clicked) {
    sweep.push({ href, ok: false, note: "link not clickable" });
    continue;
  }
  try {
    await waitFor(`location.pathname === ${JSON.stringify(href)}`, `nav ${href}`, 15000 + delayRsc);
  } catch {
    sweep.push({ href, ok: false, note: "route never changed" });
    continue;
  }
  const ms = Date.now() - t;
  await sleep(900 + delayRsc);

  const r = await readBack();
  sweep.push({
    href,
    ms,
    ok: r.asidePresent && r.sentinel === SHELL_TOKEN && (r.probe?.rootSpinner ?? -1) === 0,
    shellKept: r.asidePresent && r.sentinel === SHELL_TOKEN,
    rootSpinner: r.probe?.rootSpinner ?? "hard-load",
    appSkeleton: r.probe?.appSkeleton ?? "hard-load",
  });
}

say("");
say("── phase 2: every sidebar destination ──────────────────────");
say("TARGET".padEnd(18) + "MS".padEnd(8) + "SHELL KEPT".padEnd(12) + "ROOT SPIN".padEnd(11) + "SKELETON");
for (const s of sweep) {
  if (s.note) {
    say(s.href.padEnd(18) + "—".padEnd(8) + s.note);
    continue;
  }
  say(
    s.href.padEnd(18) + String(s.ms).padEnd(8) +
      String(s.shellKept).padEnd(12) + String(s.rootSpinner).padEnd(11) + String(s.appSkeleton),
  );
}

const sweepOk = sweep.length > 0 && sweep.every((s) => s.ok);
const pass = shellSurvived && !rootSpinnerAppeared && sweepOk;
say("");
say(`VERDICT: ${pass ? "PASS" : "FAIL"}  (phase1=${shellSurvived && !rootSpinnerAppeared}, sweep=${sweepOk})`);
say(`log: ${LOG}`);

browser.close();
try {
  process.kill(child.pid, "SIGKILL");
} catch {
  /* already gone */
}
process.exit(pass ? 0 : 1);
