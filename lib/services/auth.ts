/**
 * Auth domain service: signup, login (lockout + activity), email verification,
 * password reset/change. Route handlers stay thin; all rules live here.
 *
 * Signup/login create DB sessions (lib/auth/session.ts). Passwords: bcrypt
 * cost 12 (lib/auth/password.ts). Tokens: hashed single-use (lib/auth/tokens.ts).
 */
import { TokenType, type User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword, burnDummyPasswordCompare } from '@/lib/auth/password';
import { createSession, revokeAllSessions, type CreatedSession, type SessionMeta } from '@/lib/auth/session';
import {
  consumeToken,
  isResendCooldowned,
  issueToken,
  TokenError,
} from '@/lib/auth/tokens';
import { getMailer, Templates } from '@/lib/mailer';
import {
  OtpPurpose,
  assertPurpose,
  consumeOtpChallenge,
  issueOtpChallenge,
  otpRequestWire,
  sendOtpEmail,
  verifyOtpCode,
  type OtpRequestResult,
} from '@/lib/services/otp';
import { writeAuditLog } from '@/lib/audit';
import {
  AccountLockedError,
  ConflictError,
  SuspendedError,
  InvalidCredentialsError,
  HttpError,
} from '@/lib/api';
import type { LoginInput, SignupInput } from '@/lib/validation';

// ─── Lockout (ARCHITECTURE.md §2.5) ─────────────────────────────────────────
// 5 failed logins / 15 min / account → temporary 15-min lock.

const FAILED_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED = 5;

async function recentFailedAttempts(email: string): Promise<number> {
  return prisma.loginActivity.count({
    where: {
      email,
      success: false,
      createdAt: { gte: new Date(Date.now() - FAILED_WINDOW_MS) },
    },
  });
}

async function recordLoginActivity(opts: {
  userId?: string | null;
  email?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  success: boolean;
  reason?: string | null;
}): Promise<void> {
  await prisma.loginActivity
    .create({
      data: {
        userId: opts.userId ?? null,
        email: opts.email ?? null,
        ipAddress: opts.ipAddress ?? null,
        userAgent: opts.userAgent ?? null,
        success: opts.success,
        reason: opts.reason ?? null,
      },
    })
    .catch(() => undefined); // activity logging never blocks auth
}

// ─── Public user shape (never includes passwordHash) ────────────────────────

export interface PublicUser {
  id: string;
  name: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  bio: string | null;
  website: string | null;
  location: string | null;
  isPrivate: boolean;
  isVerified: boolean;
  emailVerified: boolean;
  platformRole: User['platformRole'];
  createdAt: Date;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
    coverUrl: user.coverUrl,
    bio: user.bio,
    website: user.website,
    location: user.location,
    isPrivate: user.isPrivate,
    isVerified: user.isVerified,
    emailVerified: !!user.emailVerifiedAt,
    platformRole: user.platformRole,
    createdAt: user.createdAt,
  };
}

// ─── Signup ─────────────────────────────────────────────────────────────────

export interface SignupResult {
  user: PublicUser;
  session: CreatedSession;
  /**
   * Raw email-verification token, for the legacy link flow and for tests. Null
   * when the account was created through OTP — the address is already proven,
   * and issuing a second, redundant proof of the same fact would just be
   * another thing that can leak.
   */
  verificationToken: string | null;
}

/**
 * The single place a user row is created.
 *
 * Split out of `signup()` because there are now two callers: the public signup
 * route (which hashes the password from the form) and the OTP verifier (which
 * already hashed it ten minutes earlier, when the challenge was created, and
 * must not be handed the plaintext again). Both end up here.
 */
async function createUserWithSession(
  input: { name: string; username: string; email: string; passwordHash: string },
  meta: SessionMeta,
  opts: { emailVerified: boolean },
): Promise<SignupResult> {
  const email = input.email.toLowerCase().trim();

  const [emailTaken, usernameTaken] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.user.findUnique({ where: { username: input.username } }),
  ]);
  if (emailTaken) throw new ConflictError('EMAIL_TAKEN', 'An account with this email already exists');
  if (usernameTaken) throw new ConflictError('USERNAME_TAKEN', 'This username is already taken');

  const user = await prisma.user.create({
    data: {
      email,
      name: input.name.trim(),
      username: input.username,
      passwordHash: input.passwordHash,
      emailVerifiedAt: opts.emailVerified ? new Date() : null,
    },
  });

  let verificationToken: string | null = null;
  if (!opts.emailVerified) {
    const issued = await issueToken(user.id, TokenType.EMAIL_VERIFICATION);
    verificationToken = issued.raw;

    // Best-effort verification email — signup succeeds even if mail fails.
    try {
      const t = Templates.verifyEmail(user.name, verificationToken);
      await getMailer().send({ to: user.email, ...t, tag: 'verify-email' });
    } catch (e) {
      console.error('[auth] failed to send verification email', e);
    }
  }

  const session = await createSession(user.id, meta);

  await writeAuditLog({
    actorId: user.id,
    action: 'account.created',
    entityType: 'user',
    entityId: user.id,
    metadata: { via: opts.emailVerified ? 'otp' : 'link' },
    ipAddress: meta.ipAddress ?? null,
  });

  return { user: toPublicUser(user), session, verificationToken };
}

/** Legacy link flow: create the account, then email a verification link. */
export async function signup(input: SignupInput, meta: SessionMeta): Promise<SignupResult> {
  const passwordHash = await hashPassword(input.password);
  return createUserWithSession(
    { name: input.name, username: input.username, email: input.email, passwordHash },
    meta,
    { emailVerified: false },
  );
}

/**
 * Step 1 of signup: prove the address before the account exists.
 *
 * Uniqueness is checked here purely for a fast, useful error — the unique
 * constraints in `createUserWithSession` are the real guard, because a race
 * between two people claiming the same address is exactly what those indexes
 * are for.
 *
 * The password is hashed NOW and only the hash is stored on the challenge, so
 * the plaintext is discarded at the edge of the request and never sits in a
 * pending row for ten minutes.
 */
export async function requestSignupOtp(input: SignupInput): Promise<OtpRequestResult> {
  const email = input.email.toLowerCase().trim();

  const [emailTaken, usernameTaken] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.user.findUnique({ where: { username: input.username } }),
  ]);
  if (emailTaken) throw new ConflictError('EMAIL_TAKEN', 'An account with this email already exists');
  if (usernameTaken) throw new ConflictError('USERNAME_TAKEN', 'This username is already taken');

  const passwordHash = await hashPassword(input.password);
  const issued = await issueOtpChallenge({
    purpose: OtpPurpose.SIGNUP,
    email,
    payload: { name: input.name.trim(), username: input.username, email, passwordHash },
  });

  await sendOtpEmail({
    to: email,
    name: input.name,
    code: issued.code,
    purpose: 'SIGNUP',
  });

  return otpRequestWire(issued, email);
}

/** Step 2 of signup: a correct code is what brings the account into existence. */
export async function completeSignupOtp(
  challengeId: string,
  code: string,
  meta: SessionMeta,
): Promise<SignupResult> {
  const challenge = await verifyOtpCode(challengeId, code);
  assertPurpose(challenge, OtpPurpose.SIGNUP);

  const payload = challenge.payload as {
    name: string;
    username: string;
    email: string;
    passwordHash: string;
  };

  const result = await createUserWithSession(
    {
      name: payload.name,
      username: payload.username,
      email: payload.email,
      passwordHash: payload.passwordHash,
    },
    meta,
    { emailVerified: true },
  );

  await consumeOtpChallenge(challenge.id);
  return result;
}

// ─── Login ──────────────────────────────────────────────────────────────────

export interface LoginResult {
  user: PublicUser;
  session: CreatedSession;
  /** False until the user verifies their email; writes are blocked meanwhile. */
  emailVerified: boolean;
}

export async function login(input: LoginInput, meta: SessionMeta): Promise<LoginResult> {
  const email = input.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email } });

  const fail = async (reason: string, err: HttpError) => {
    await recordLoginActivity({
      userId: user?.id ?? null,
      email,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      success: false,
      reason,
    });
    throw err;
  };

  if (!user || user.deletedAt) {
    // Same error as bad password — no account enumeration. A real bcrypt
    // comparison takes ~250ms while this path would otherwise return
    // instantly, a timing oracle for account existence; burn equivalent
    // work first so both outcomes are indistinguishable by timing.
    await burnDummyPasswordCompare(input.password);
    return fail('bad_password', new InvalidCredentialsError());
  }
  if (!user.isActive) {
    return fail('account_suspended', new SuspendedError('This account has been suspended'));
  }
  if ((await recentFailedAttempts(email)) >= MAX_FAILED) {
    return fail('account_locked', new AccountLockedError());
  }
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    return fail('bad_password', new InvalidCredentialsError());
  }

  await recordLoginActivity({
    userId: user.id,
    email,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    success: true,
  });

  const session = await createSession(user.id, meta);
  const emailVerified = !!user.emailVerifiedAt;
  if (!emailVerified) {
    await recordLoginActivity({
      userId: user.id,
      email,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      success: true,
      reason: 'unverified_email',
    });
  }
  // Unverified users DO receive a session (limited token): it lets them verify
  // their email / resend the code. requireVerified() blocks all writes (403
  // EMAIL_UNVERIFIED) until then.
  return { user: toPublicUser(user), session, emailVerified };
}

// ─── Email verification ─────────────────────────────────────────────────────

export async function verifyEmail(rawToken: string, ipAddress?: string | null): Promise<PublicUser> {
  const { userId } = await consumeToken(rawToken, TokenType.EMAIL_VERIFICATION);
  const user = await prisma.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
  });
  await writeAuditLog({
    actorId: user.id,
    action: 'account.email_verified',
    entityType: 'user',
    entityId: user.id,
    ipAddress: ipAddress ?? null,
  });
  return toPublicUser(user);
}

export async function resendVerification(user: User): Promise<void> {
  if (user.emailVerifiedAt) {
    throw new ConflictError('ALREADY_VERIFIED', 'Email is already verified');
  }
  if (await isResendCooldowned(user.id, TokenType.EMAIL_VERIFICATION)) {
    throw new HttpError(429, 'RATE_LIMITED', 'Please wait before requesting another code');
  }
  const { raw } = await issueToken(user.id, TokenType.EMAIL_VERIFICATION);
  const t = Templates.verifyEmail(user.name, raw);
  await getMailer().send({ to: user.email, ...t, tag: 'verify-email' });
}

// ─── Password reset ─────────────────────────────────────────────────────────

export async function forgotPassword(email: string): Promise<void> {
  const normalized = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  // Always { ok: true } — no account enumeration.
  if (!user || user.deletedAt || !user.isActive) return;
  const { raw } = await issueToken(user.id, TokenType.PASSWORD_RESET);
  try {
    const t = Templates.resetPassword(user.name, raw);
    await getMailer().send({ to: user.email, ...t, tag: 'reset-password' });
  } catch (e) {
    console.error('[auth] failed to send reset email', e);
  }
}

export async function resetPassword(rawToken: string, newPassword: string, meta: SessionMeta): Promise<PublicUser> {
  let userId: string;
  try {
    ({ userId } = await consumeToken(rawToken, TokenType.PASSWORD_RESET));
  } catch (e) {
    if (e instanceof TokenError) throw e;
    throw e;
  }
  const passwordHash = await hashPassword(newPassword);
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    // Compromise containment: kill every session.
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return updated;
  });
  await writeAuditLog({
    actorId: user.id,
    action: 'account.password_reset',
    entityType: 'user',
    entityId: user.id,
    ipAddress: meta.ipAddress ?? null,
  });
  try {
    const t = Templates.securityAlert(user.name, 'Your password was reset', meta.ipAddress);
    await getMailer().send({ to: user.email, ...t, tag: 'security-alert' });
  } catch (e) {
    console.error('[auth] failed to send security alert', e);
  }
  return toPublicUser(user);
}

// ─── Password change (authenticated) ────────────────────────────────────────

export async function changePassword(
  user: User,
  currentPassword: string,
  newPassword: string,
  meta: SessionMeta & { currentSessionId: string },
): Promise<{ revokedOthers: number }> {
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new InvalidCredentialsError('Current password is incorrect');
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  // Keep the current session alive; revoke everything else.
  const { revokeOtherSessions } = await import('@/lib/auth/session');
  const revokedOthers = await revokeOtherSessions(user.id, meta.currentSessionId);
  await writeAuditLog({
    actorId: user.id,
    action: 'account.password_changed',
    entityType: 'user',
    entityId: user.id,
    ipAddress: meta.ipAddress ?? null,
  });
  try {
    const t = Templates.securityAlert(user.name, 'Your password was changed', meta.ipAddress);
    await getMailer().send({ to: user.email, ...t, tag: 'security-alert' });
  } catch (e) {
    console.error('[auth] failed to send security alert', e);
  }
  return { revokedOthers };
}

/** Paginated own login activity for the security settings screen. */
export async function getLoginActivity(
  userId: string,
  opts: { limit: number; cursor: string | null },
) {
  const { decodeCursor, encodeCursor } = await import('@/lib/api');
  const where: Record<string, unknown> = { userId };
  if (opts.cursor) {
    const { createdAt, id } = decodeCursor(opts.cursor);
    where.OR = [
      { createdAt: { lt: createdAt } },
      { createdAt: { equals: createdAt }, id: { lt: id } },
    ];
  }
  const rows = await prisma.loginActivity.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
  });
  const hasMore = rows.length > opts.limit;
  const data = (hasMore ? rows.slice(0, opts.limit) : rows).map((r) => ({
    id: r.id,
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    success: r.success,
    reason: r.reason,
    createdAt: r.createdAt,
  }));
  const nextCursor =
    hasMore && data.length > 0
      ? encodeCursor(data[data.length - 1]!.createdAt, data[data.length - 1]!.id)
      : null;
  return { data, nextCursor };
}

export { revokeAllSessions };
