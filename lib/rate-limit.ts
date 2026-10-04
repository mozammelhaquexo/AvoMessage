/**
 * In-memory token-bucket rate limiter.
 *
 * Buckets are keyed (typically `<preset>:<ip>`); each bucket refills to full
 * after its window. This is a v1 single-instance implementation —
 *
 *   REDIS SWAP POINT: replace the `buckets` Map with Redis: on each check do
 *   `INCR key`, set `EXPIRE key window` on first hit, and compare against the
 *   limit. Everything else (presets, return shape, call sites) stays the same.
 *
 * Tests disable the limiter with `RATE_LIMIT_DISABLED=1`.
 */
import type { NextRequest } from 'next/server';

export const RATE_LIMITS = {
  /** Login / password / verification endpoints. */
  auth: { limit: 10, windowMs: 60_000 },
  /**
   * OTP request + verify. Tighter than `auth` on purpose: every request here
   * sends an email (real money-free but rate-limited by the provider) or
   * guesses a code. The per-challenge attempt cap and the resend cooldown are
   * the primary defences; this is the per-IP backstop behind them.
   */
  otp: { limit: 6, windowMs: 60_000 },
  /** Registrations per IP per hour (ARCHITECTURE.md §2.5). */
  register: { limit: 5, windowMs: 3_600_000 },
  /** Generic authenticated writes. */
  write: { limit: 60, windowMs: 60_000 },
  /** Reads. */
  read: { limit: 300, windowMs: 60_000 },
  /** Uploads per hour. */
  upload: { limit: 20, windowMs: 3_600_000 },
} as const;

export type RateLimitPreset = keyof typeof RATE_LIMITS;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Bound memory: prune expired buckets opportunistically.
let lastPrune = 0;
function prune(now: number): void {
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function checkRateLimit(opts: {
  key: string;
  limit?: number;
  windowMs?: number;
}): RateLimitResult {
  const limit = opts.limit ?? Number(process.env.RATE_LIMIT_DEFAULT_PER_MIN ?? 300);
  const windowMs = opts.windowMs ?? 60_000;

  if (process.env.RATE_LIMIT_DISABLED === '1') {
    return { allowed: true, remaining: limit, retryAfterMs: 0 };
  }

  const now = Date.now();
  prune(now);
  const bucket = buckets.get(opts.key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(opts.key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: bucket.resetAt - now };
  }
  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, retryAfterMs: 0 };
}

/** Best-effort client IP (trusts x-forwarded-for from the platform proxy). */
export function getClientIp(req: NextRequest | Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Test/ops helper: clear all buckets (or one key). */
export function resetRateLimits(key?: string): void {
  if (key) buckets.delete(key);
  else buckets.clear();
}
