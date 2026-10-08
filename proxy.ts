/**
 * Global proxy (Next.js 16 renamed `middleware` -> `proxy`; the proxy runs on
 * the nodejs runtime, which is required here because the CSRF check imports
 * `node:crypto` — the edge runtime cannot load it, which 500'd every request.
 *
 * Responsibilities:
 *
 * 1. CSRF double-submit check for unsafe /api/* methods (the production
 *    net — every route ALSO checks inside `handle()` in lib/api.ts, which
 *    keeps the rule explicit, testable, and enforced even if middleware is
 *    bypassed).
 * 2. Per-request CSP nonce: generates a fresh nonce, exposes it to the app
 *    via the `x-nonce` request header (the root layout passes it to the
 *    inline theme script), and sets the Content-Security-Policy response
 *    header. See docs/SECURITY_REVIEW.md §6 for the rationale and the
 *    CSP_MODE escape hatch.
 *
 * CSRF-exempt (cannot present a token yet — not cookie-authed):
 *   POST /api/auth/signup | /register | /login | /verify-email |
 *        /forgot-password | /reset-password | /signup/verify
 *
 * `/api/auth/signup/verify` is on the list for the same reason as `/signup`
 * itself: the visitor has no session, and the CSRF cookie is only issued
 * alongside one, so there is no double-submit pair to compare. The endpoint is
 * not unprotected — it needs a valid challenge id and a 6-digit code that was
 * mailed to the address being claimed, and it is rate-limited and attempt-capped.
 *
 * The two company OTP endpoints are deliberately NOT here: their callers are
 * signed in, so they get the normal check.
 */
import { NextRequest, NextResponse } from 'next/server';
import { hasValidCsrf } from '@/lib/auth/csrf';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const CSRF_EXEMPT = new Set([
  '/api/auth/signup',
  '/api/auth/signup/verify',
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/verify-email',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
]);

/** Request header carrying the per-request CSP nonce to Server Components. */
export const NONCE_HEADER = 'x-nonce';

function buildCsp(nonce: string): string {
  const isProd = process.env.NODE_ENV === 'production';
  const directives = [
    "default-src 'self'",
    // Next.js emits inline bootstrap/RSC-flight scripts; they carry this
    // request's nonce (the framework reads `x-nonce` from the request
    // headers). 'strict-dynamic' lets those trusted scripts load the rest
    // of the chunks they need.
    //
    // 'unsafe-eval' is DEVELOPMENT-ONLY. React's dev build calls eval() to
    // reconstruct callstacks across environments, so without it every page
    // logs a Console Error. React never calls eval() in production, so
    // shipping it there would only re-open a hole CSP exists to close.
    // 'unsafe-eval' is independent of 'strict-dynamic' — the latter governs
    // which scripts may load, not whether eval() is permitted.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProd ? '' : " 'unsafe-eval'"}`,
    // The service worker (`public/sw.js`) needs this, and it is NOT optional.
    // `worker-src` falls back to `child-src` and then to `script-src`, and a
    // `script-src` containing a nonce or hash makes browsers IGNORE its `'self'`
    // source entirely (that is what 'strict-dynamic' means). Without an explicit
    // `worker-src`, `navigator.serviceWorker.register('/sw.js')` is refused with
    // a CSP violation — and a refused service worker is a refused push
    // notification, which is the whole feature. There is nothing to gain by
    // nonce-ing a worker: the URL is fixed and same-origin.
    "worker-src 'self'",
    // Tailwind ships a compiled stylesheet; React sets a few inline styles.
    "style-src 'self' 'unsafe-inline'",
    // Avatars/uploads served from self or S3_PUBLIC_URL, plus data:/blob:
    // object URLs used by the composer and voice-message previews.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    // Same-origin API + socket.io (ws/wss). WebRTC ICE (STUN/TURN) uses raw
    // UDP/TCP and is not governed by connect-src.
    "connect-src 'self' ws: wss: https:",
    // Voice messages and media served from self, S3, or object URLs.
    "media-src 'self' blob: https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Clickjacking: never frameable (mirrors X-Frame-Options: DENY).
    "frame-ancestors 'none'",
  ];
  // Local dev serves plain HTTP; upgrading would break it. Browsers exempt
  // localhost anyway, but keep the directive production-only to be explicit.
  if (isProd) {
    directives.push('upgrade-insecure-requests');
  }
  return directives.join('; ');
}

/**
 * CSP enforcement mode. Default `enforce`. Set `CSP_MODE=report-only` to
 * downgrade to Content-Security-Policy-Report-Only (diagnose violations
 * without breaking rendering), or `CSP_MODE=off` to disable entirely.
 */
function cspHeaderName(): 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only' | null {
  const mode = (process.env.CSP_MODE ?? 'enforce').toLowerCase();
  if (mode === 'off') return null;
  return mode === 'report-only'
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';
}

export function proxy(req: NextRequest) {
  // 128-bit nonce, hex — no Buffer needed (works in Edge and Node runtimes).
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const cspHeader = cspHeaderName();
  const cspValue = cspHeader ? buildCsp(nonce) : null;

  const applyCsp = (res: NextResponse): NextResponse => {
    if (cspHeader && cspValue) res.headers.set(cspHeader, cspValue);
    return res;
  };

  // 1. CSRF for cookie-authed API mutations.
  if (
    req.nextUrl.pathname.startsWith('/api/') &&
    UNSAFE.has(req.method) &&
    !CSRF_EXEMPT.has(req.nextUrl.pathname)
  ) {
    if (!hasValidCsrf(req)) {
      return applyCsp(
        NextResponse.json(
          { error: { code: 'CSRF_INVALID', message: 'Invalid CSRF token' } },
          { status: 403 },
        ),
      );
    }
  }

  // 2. Propagate the nonce and the pathname to Server Components and set
  // the CSP header. The pathname lets route-group layouts make path-aware
  // decisions (e.g. the (public) layout's authed-user redirect allowlist).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);
  return applyCsp(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  // Run on pages too (for the CSP header), not just /api/*. Static Next
  // internals are excluded.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
