/**
 * lib/realtime/store.ts — database + session verification for the realtime layer.
 *
 * Two responsibilities:
 *   1. `getDb()` — lazy access to the shared Prisma singleton (`lib/db.ts`).
 *      Returns null when the client is not installed/generated yet; every
 *      socket handler treats that as "fail closed" (reject the operation).
 *   2. `verifyHandshakeSession()` — verify the signed `avo_session` cookie
 *      from a raw `Cookie` header, per docs/ARCHITECTURE.md §2.2:
 *        cookie: avo_session=<raw>.<sig>, sig = HMAC_SHA256(SESSION_SECRET, raw)
 *        DB: Session.tokenHash = SHA256(raw) (hex)
 *        checks: signature (constant-time) → session exists → not revoked →
 *        not expired → user active. Sliding expiry refreshed (debounced 5 min).
 *
 * NOTE ON DUPLICATION: this intentionally does NOT import
 * `lib/auth/session.ts`. That module uses the `@/` path alias, which plain
 * `node` cannot resolve in the compiled server build (`tsc -p
 * tsconfig.server.json` → `dist-server/`), and it eagerly constructs a
 * PrismaClient at import time (throws while the client is ungenerated).
 * The protocol here is byte-for-byte the same as
 * `getSessionFromRequest()` — if the cookie protocol ever changes, update
 * both places (the backend/auth team owns `lib/auth/session.ts`).
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PrismaClientLike } from '../prisma-types.js';

export const SESSION_COOKIE_NAME = 'avo_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_DEBOUNCE_MS = 5 * 60 * 1000; // ≤1 sliding-refresh write / 5 min

// ─────────────────────────────────────────────────────────────────────────────
// Database handle (lazy, fail-closed)
// ─────────────────────────────────────────────────────────────────────────────

let cachedDb: PrismaClientLike | null = null;
let dbAttempted = false;

/**
 * Explicit override (tests, or hosts that construct their own client).
 * Takes precedence over the lazy `lib/db.ts` singleton when set.
 */
let dbOverride: PrismaClientLike | null = null;
let overrideSet = false;

export function setDbOverride(db: PrismaClientLike | null): void {
  dbOverride = db;
  overrideSet = true;
}

/**
 * The shared Prisma client, or null when it cannot be constructed
 * (package not installed / client not generated yet). Callers MUST treat
 * null as "fail closed": reject the handshake / event, never proceed
 * unauthenticated.
 */
export function getDb(): PrismaClientLike | null {
  if (overrideSet) return dbOverride;
  if (!dbAttempted) {
    dbAttempted = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('../db.js') as {
        prisma?: PrismaClientLike;
        default?: PrismaClientLike;
      };
      cachedDb = mod.prisma ?? mod.default ?? null;
    } catch (err) {
      console.warn(
        `[realtime] database unavailable (${(err as Error).message}). ` +
          'Socket handshakes will be rejected until @prisma/client is installed and generated.',
      );
      cachedDb = null;
    }
  }
  return cachedDb;
}

/** Test/ops helper: drop the cached handle so the next getDb() retries. */
export function resetDbCache(): void {
  cachedDb = null;
  dbAttempted = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session verification (mirrors lib/auth/session.ts#getSessionFromRequest)
// ─────────────────────────────────────────────────────────────────────────────

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      '[realtime] SESSION_SECRET must be set and at least 32 characters long.',
    );
  }
  return secret;
}

function parseSessionCookie(
  cookieHeader: string | null | undefined,
): { raw: string; sig: string } | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== SESSION_COOKIE_NAME) continue;
    let value: string;
    try {
      value = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return null;
    }
    const dot = value.lastIndexOf('.');
    if (dot <= 0 || dot === value.length - 1) return null;
    return { raw: value.slice(0, dot), sig: value.slice(dot + 1) };
  }
  return null;
}

function signatureValid(raw: string, sig: string): boolean {
  const expected = createHmac('sha256', sessionSecret())
    .update(raw, 'utf8')
    .digest('hex');
  let actual: Buffer;
  try {
    actual = Buffer.from(sig, 'hex');
  } catch {
    return false;
  }
  const expectedBuf = Buffer.from(expected, 'hex');
  return (
    actual.length === expectedBuf.length &&
    timingSafeEqual(actual, expectedBuf)
  );
}

export interface HandshakeSession {
  userId: string;
  sessionId: string;
}

/**
 * Verify the session cookie from a Socket.io handshake. Returns null when
 * there is no usable session (missing/invalid cookie, unknown / revoked /
 * expired session, suspended user) or when the database is unavailable.
 * Throws only on server misconfiguration (missing SESSION_SECRET) — the
 * handshake middleware turns that into a connection error (fail closed).
 */
export async function verifyHandshakeSession(
  cookieHeader: string | undefined,
): Promise<HandshakeSession | null> {
  const parsed = parseSessionCookie(cookieHeader);
  if (!parsed) return null;
  // Enforce the 32-byte hex token shape before touching crypto/DB.
  if (!/^[0-9a-f]{64}$/.test(parsed.raw)) return null;
  if (!signatureValid(parsed.raw, parsed.sig)) return null;

  const database = getDb();
  if (!database) return null;

  const tokenHash = createHash('sha256').update(parsed.raw, 'utf8').digest('hex');
  const session = await database.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return null;
  }
  const user = (
    session as unknown as {
      user: { id: string; isActive: boolean; deletedAt: Date | null } | null;
    }
  ).user;
  if (!user || user.isActive === false || user.deletedAt) return null;

  // Sliding refresh, debounced — best effort, never fail auth on it.
  if (Date.now() - session.lastActiveAt.getTime() > REFRESH_DEBOUNCE_MS) {
    const now = new Date();
    await database.session
      .update({
        where: { id: session.id },
        data: {
          lastActiveAt: now,
          expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        },
      })
      .catch(() => undefined);
  }

  return { userId: user.id, sessionId: session.id };
}
