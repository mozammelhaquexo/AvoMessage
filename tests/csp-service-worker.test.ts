/**
 * The Content-Security-Policy must let the app register its service worker.
 *
 * WHY THIS DESERVES ITS OWN TEST
 * `proxy.ts` builds `script-src` as
 * `'self' 'nonce-…' 'strict-dynamic'`. The moment a nonce (or a hash) is present
 * in `script-src`, browsers IGNORE the `'self'` source — that is the whole point
 * of `'strict-dynamic'`. `worker-src` has no source of its own here, so it falls
 * back to `child-src` and then to `script-src`, and
 * `navigator.serviceWorker.register('/sw.js')` is refused.
 *
 * A refused service worker means a refused Web Push subscription, which means
 * no notification when the tab is closed — the exact feature this work exists
 * to deliver. And the failure is invisible in the app's own logs: the console
 * shows a CSP violation, the registration promise rejects, and the UI simply
 * never receives anything.
 *
 * So the assertion is not "the header contains some string" — it is that
 * `worker-src` is present AND that `script-src` is in the state that makes it
 * necessary. If someone later drops the nonce from `script-src`, the second
 * assertion explains why the first no longer matters.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

/**
 * `NODE_ENV` is declared readonly on `ProcessEnv` (and narrowed to a union), so
 * a plain assignment does not type-check. `vi.stubEnv` is the supported route
 * and also guarantees the value is restored afterwards — a leaked
 * `NODE_ENV=production` would silently change every later test in this worker.
 */
beforeEach(() => {
  vi.stubEnv('CSP_MODE', 'enforce');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The CSP header `proxy` would put on a normal page response. */
function cspFor(path = '/'): string {
  const res = proxy(new NextRequest(`http://localhost${path}`));
  const value = res.headers.get('Content-Security-Policy');
  expect(value, 'proxy must emit an enforcing CSP header').not.toBeNull();
  return value!;
}

/** One directive's value, e.g. `script-src 'self' …` -> `'self' …`. */
function directive(csp: string, name: string): string | null {
  for (const part of csp.split(';')) {
    const trimmed = part.trim();
    if (trimmed === name) return '';
    if (trimmed.startsWith(`${name} `)) return trimmed.slice(name.length + 1);
  }
  return null;
}

describe('service worker CSP', () => {
  it('allows same-origin workers', () => {
    const csp = cspFor();
    const workerSrc = directive(csp, 'worker-src');
    expect(workerSrc).not.toBeNull();
    expect(workerSrc).toContain("'self'");
  });

  it('is genuinely necessary, because script-src carries a nonce', () => {
    const scriptSrc = directive(cspFor(), 'script-src')!;
    // With a nonce present, browsers ignore 'self' in script-src — so the
    // worker-src fallback would be an empty allowance without the directive.
    expect(scriptSrc).toContain("'nonce-");
    expect(scriptSrc).toContain("'strict-dynamic'");
  });

  it('applies on every page, not just /api routes', () => {
    // The worker is registered from the app shell, so the header has to be on
    // the document response — not only on API calls.
    for (const path of ['/', '/messages', '/settings']) {
      expect(directive(cspFor(path), 'worker-src')).toBe("'self'");
    }
  });

  it('still denies framing and plugin content', () => {
    const csp = cspFor();
    expect(directive(csp, 'frame-ancestors')).toBe("'none'");
    expect(directive(csp, 'object-src')).toBe("'none'");
  });

  it('does not widen script-src to make the worker work', () => {
    // The tempting shortcut is adding 'unsafe-inline' or 'unsafe-eval' to
    // script-src. Neither would help a worker, and both would undo the point of
    // the policy — so pin the absences, in production, where they must hold.
    vi.stubEnv('NODE_ENV', 'production');
    const scriptSrc = directive(cspFor(), 'script-src')!;
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("keeps 'unsafe-eval' development-only, and the worker allowed in both", () => {
    vi.stubEnv('NODE_ENV', 'development');
    const dev = cspFor();
    // React's dev build calls eval() to reconstruct callstacks.
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(dev, 'worker-src')).toBe("'self'");

    vi.stubEnv('NODE_ENV', 'production');
    const prod = cspFor();
    expect(directive(prod, 'script-src')).not.toContain("'unsafe-eval'");
    expect(directive(prod, 'worker-src')).toBe("'self'");
  });
});
