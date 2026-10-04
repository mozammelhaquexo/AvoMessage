/**
 * Double-submit CSRF protection (ARCHITECTURE.md §2.3).
 *
 * On session creation the server sets a non-HttpOnly cookie `avo_csrf`
 * holding a random token. Browser mutations must echo that value in the
 * `x-csrf-token` header. The server compares the two with a constant-time
 * comparison — no server-side state, works across instances.
 *
 * Enforced for every unsafe method (POST/PUT/PATCH/DELETE) on /api/* by:
 *   1. `middleware.ts` (production net), and
 *   2. `handle()` in lib/api.ts (explicit per-route check, testable).
 * Pre-auth routes (signup/login/verify-email/forgot/reset-password) cannot
 * present a token yet and are exempt — they are not cookie-authed.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { CsrfError } from '@/lib/api';

export const CSRF_COOKIE_NAME = 'avo_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

/** 256-bit random token, hex-encoded. */
export function issueCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Throws CsrfError (403 CSRF_INVALID) unless the `x-csrf-token` header
 * matches the `avo_csrf` cookie. Safe to call on any request.
 */
export function assertCsrf(req: NextRequest): void {
  const header = req.headers.get(CSRF_HEADER_NAME);
  const cookie = req.cookies.get(CSRF_COOKIE_NAME)?.value;
  if (!header || !cookie || !safeEqual(header, cookie)) {
    throw new CsrfError();
  }
}

/** Non-throwing variant for contexts that want a boolean. */
export function hasValidCsrf(req: NextRequest): boolean {
  try {
    assertCsrf(req);
    return true;
  } catch {
    return false;
  }
}
