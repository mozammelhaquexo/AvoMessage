/**
 * DB-backed sessions (ARCHITECTURE.md §2.2). No JWT.
 *
 * Cookie: `avo_session=<raw>.<sig>` where `sig = HMAC_SHA256(SESSION_SECRET, raw)`.
 * The DB stores only `SHA-256(raw)` (`Session.tokenHash`) — a stolen DB dump
 * cannot mint cookies, and a stolen cookie cannot be reversed to anything else.
 *
 * Cookie flags: HttpOnly; Secure in production; SameSite=Lax; Path=/; Max-Age=30d.
 * Sliding refresh: expiresAt = now+30d, debounced to 1 write per 5 min/session.
 */
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import type { Session, User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { CSRF_COOKIE_NAME, issueCsrfToken } from '@/lib/auth/csrf';

export const SESSION_COOKIE_NAME = 'avo_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_DEBOUNCE_MS = 5 * 60 * 1000; // 1 write per 5 min per session

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET must be set to at least 32 bytes of randomness (see .env.example)',
    );
  }
  return secret;
}

/** SHA-256 hex of the raw token — what is stored in Session.tokenHash. */
export function hashSessionToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function sign(raw: string): string {
  return createHmac('sha256', getSessionSecret()).update(raw, 'utf8').digest('hex');
}

function verifySignature(raw: string, sig: string): boolean {
  const expected = Buffer.from(sign(raw), 'hex');
  let actual: Buffer;
  try {
    actual = Buffer.from(sig, 'hex');
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export interface SessionMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreatedSession {
  session: Session;
  /** Value for the `avo_session` cookie: `<raw>.<sig>`. */
  cookieValue: string;
  /** Fresh double-submit CSRF token (also set as `avo_csrf` cookie). */
  csrfToken: string;
}

/**
 * Create a session row + signed cookie value for a user.
 * Callers set the cookies via setAuthCookies() and return the CSRF token.
 */
export async function createSession(userId: string, meta: SessionMeta = {}): Promise<CreatedSession> {
  const raw = randomBytes(32).toString('hex');
  const now = new Date();
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(raw),
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      lastActiveAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    },
  });
  return {
    session,
    cookieValue: `${raw}.${sign(raw)}`,
    csrfToken: issueCsrfToken(),
  };
}

function cookieFlags(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** Set `avo_session` (httpOnly) + `avo_csrf` (readable) cookies on a response. */
export function setAuthCookies(res: NextResponse, created: CreatedSession): void {
  res.cookies.set(SESSION_COOKIE_NAME, created.cookieValue, cookieFlags(SESSION_TTL_MS / 1000));
  res.cookies.set(CSRF_COOKIE_NAME, created.csrfToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/** Clear both auth cookies (logout). */
export function clearAuthCookies(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE_NAME, '', { ...cookieFlags(0), maxAge: 0 });
  res.cookies.set(CSRF_COOKIE_NAME, '', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 0,
  });
}

export interface RequestSession {
  user: User;
  session: Session;
}

/**
 * Resolve the session for an incoming request. Returns null when there is no
 * usable session (missing/invalid cookie, unknown/revoked/expired session,
 * suspended or deleted user). Performs the debounced sliding refresh.
 */
export async function getSessionFromRequest(req: NextRequest): Promise<RequestSession | null> {
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) return null;

  const dot = cookieValue.lastIndexOf('.');
  if (dot <= 0) return null;
  const raw = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(raw) || !verifySignature(raw, sig)) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(raw) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  if (!session.user.isActive || session.user.deletedAt) return null;

  // Sliding refresh, debounced to avoid a write on every request.
  if (Date.now() - session.lastActiveAt.getTime() > REFRESH_DEBOUNCE_MS) {
    const now = new Date();
    await prisma.session
      .update({
        where: { id: session.id },
        data: { lastActiveAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) },
      })
      .catch(() => undefined); // best-effort; never fail the request on refresh
  }

  return { user: session.user, session };
}

/** Revoke the session identified by a raw cookie value (logout). */
export async function destroySessionByCookieValue(cookieValue: string): Promise<void> {
  const dot = cookieValue.lastIndexOf('.');
  if (dot <= 0) return;
  const raw = cookieValue.slice(0, dot);
  await prisma.session
    .updateMany({
      where: { tokenHash: hashSessionToken(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    })
    .catch(() => undefined);
}

/** Revoke one session owned by the user (not usable for the current session via API). */
export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const res = await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count > 0;
}

/** "Log out other devices": revoke every session except the current one. */
export async function revokeOtherSessions(userId: string, currentSessionId: string): Promise<number> {
  const res = await prisma.session.updateMany({
    where: { userId, revokedAt: null, id: { not: currentSessionId } },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

/** Revoke ALL sessions for a user (password reset, suspension). */
export async function revokeAllSessions(userId: string): Promise<number> {
  const res = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

export interface SessionInfo {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastActiveAt: Date;
  createdAt: Date;
  current: boolean;
}

/** Active sessions for the sessions/devices settings screen. */
export async function listUserSessions(userId: string, currentSessionId: string): Promise<SessionInfo[]> {
  const sessions = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastActiveAt: 'desc' },
  });
  return sessions.map((s) => ({
    id: s.id,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    lastActiveAt: s.lastActiveAt,
    createdAt: s.createdAt,
    current: s.id === currentSessionId,
  }));
}
