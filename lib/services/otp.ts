/**
 * lib/services/otp.ts — one-time passcodes, the gate on every account-creating
 * path in AvoMessage.
 *
 * Three flows use this, and they share the same machinery deliberately:
 *
 *   SIGNUP          a visitor proves the address, and only then does a user
 *                   row come into existence;
 *   COMPANY_MEMBER  a manager enters a member's email + password; the member
 *                   proves the address before the account is created;
 *   COMPANY_MANAGER an administrator does the same for a new manager.
 *
 * ── Why the pending action lives in the database, not the client ────────────
 *
 * The naive shape is a two-step form: step 1 posts the details and gets a code,
 * step 2 posts the details AGAIN plus the code. That is broken — nothing binds
 * the code to the payload, so anyone who can receive a code for their own
 * address can redeem it against a different address, company or role in step 2.
 *
 * Here step 1 stores the whole pending action in `OtpChallenge.payload`, and
 * step 2 sends only `{ challengeId, code }`. The client never gets to restate
 * what it is asking for. That also means the bcrypt password hash sits in the
 * database for ten minutes rather than in a hidden form field.
 *
 * ── Why the hash is peppered ───────────────────────────────────────────────
 *
 * A 6-digit code is a 10^6 space. A bare SHA-256 of it is reversible from a
 * database dump by brute force in well under a second, which would turn a
 * read-only leak into account takeover on every in-flight signup. The stored
 * value is therefore HMAC-SHA256(OTP_SECRET, `${challengeId}:${code}`) — the
 * secret is what makes the digest useless on its own, and mixing in the
 * challenge id means a code issued for one challenge can never satisfy another,
 * even for the same address and purpose.
 *
 * ── The four defences, and why all four are needed ─────────────────────────
 *
 *   expiry (10 min)      limits the window a leaked code is useful in;
 *   attempt cap (5)      makes online guessing a ~1-in-200,000 shot;
 *   resend cooldown      stops a resend loop from resetting the attempt cap;
 *   per-IP rate limit    stops one host from farming challenges for many
 *                        addresses (see the `otp` preset in lib/rate-limit).
 *
 * Removing any one of them opens a hole, so they are not configurable to "off".
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { OtpPurpose } from '@prisma/client';
import { prisma } from '@/lib/db';
import { HttpError } from '@/lib/api';
import { getMailer, Templates } from '@/lib/mailer';
import type { OtpEmailPurpose } from '@/lib/mail/otp-template';

export const OTP_TTL_MS = Number(process.env.OTP_TTL_MS ?? 10 * 60 * 1000);
export const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS ?? 5);
export const OTP_RESEND_COOLDOWN_MS = Number(process.env.OTP_RESEND_COOLDOWN_MS ?? 60_000);

/** Digits in a code. Changing this invalidates nothing, but the UI assumes 6. */
export const OTP_LENGTH = 6;

/**
 * The pepper. Required in every environment: without it the stored digest is
 * reversible and the whole scheme collapses to "hash of a 6-digit number".
 * Failing loudly at first use is better than silently weakening every flow.
 */
function otpSecret(): string {
  const secret = process.env.OTP_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'OTP_SECRET must be set (>=16 chars) — it peppers the stored OTP digest. See .env.example.',
    );
  }
  return secret;
}

export function hashOtpCode(challengeId: string, code: string): string {
  return createHmac('sha256', otpSecret()).update(`${challengeId}:${code}`, 'utf8').digest('hex');
}

/** Cryptographically random, zero-padded to a fixed width. Never Math.random. */
export function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, '0');
}

/**
 * Constant-time compare of two hex digests. Both are always 64 chars (SHA-256),
 * so the length guard is a belt-and-braces check rather than a leak.
 */
export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export class OtpError extends HttpError {
  constructor(
    code:
      | 'OTP_INVALID'
      | 'OTP_EXPIRED'
      | 'OTP_USED'
      | 'OTP_ATTEMPTS_EXCEEDED'
      | 'OTP_RESEND_TOO_SOON',
    message: string,
    status = 400,
  ) {
    super(status, code, message);
  }
}

export interface IssueOtpInput {
  purpose: OtpPurpose;
  email: string;
  /** The whole pending action. Stored verbatim; never echoed to the client. */
  payload: Record<string, unknown>;
  /** Who triggered it. null for self-signup. Re-checked at verify time. */
  createdById?: string | null;
}

export interface IssuedOtp {
  challengeId: string;
  /** Raw code, for the email and for tests. Never returned by a route. */
  code: string;
  expiresAt: Date;
  /** How long until a resend is accepted, in ms. */
  resendAfterMs: number;
}

/** Normalise before storing or comparing — `A@B.com` and `a@b.com` are one inbox. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Create a challenge and return the code to send.
 *
 * Any earlier *unfinished* challenge for the same address + purpose is deleted
 * first: two live codes for one address is a support nightmare and doubles the
 * guessing surface. Deleting also resets the attempt counter, which is exactly
 * why the resend is behind a cooldown.
 */
export async function issueOtpChallenge(input: IssueOtpInput): Promise<IssuedOtp> {
  const email = normalizeEmail(input.email);
  const now = new Date();

  const latest = await prisma.otpChallenge.findFirst({
    where: { email, purpose: input.purpose },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (latest) {
    const elapsed = now.getTime() - latest.createdAt.getTime();
    if (elapsed < OTP_RESEND_COOLDOWN_MS) {
      const retryAfterMs = OTP_RESEND_COOLDOWN_MS - elapsed;
      throw new OtpError(
        'OTP_RESEND_TOO_SOON',
        `Please wait ${Math.ceil(retryAfterMs / 1000)}s before requesting another code`,
        429,
      );
    }
  }

  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
  const code = generateOtpCode();

  const challenge = await prisma.$transaction(async (tx) => {
    await tx.otpChallenge.deleteMany({
      where: { email, purpose: input.purpose, consumedAt: null },
    });
    return tx.otpChallenge.create({
      data: {
        purpose: input.purpose,
        email,
        // Hashed after the row exists, because the id is part of the input.
        codeHash: 'pending',
        payload: input.payload as never,
        maxAttempts: OTP_MAX_ATTEMPTS,
        expiresAt,
        createdById: input.createdById ?? null,
      },
    });
  });

  const codeHash = hashOtpCode(challenge.id, code);
  await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { codeHash } });

  return {
    challengeId: challenge.id,
    code,
    expiresAt,
    resendAfterMs: OTP_RESEND_COOLDOWN_MS,
  };
}

export interface VerifiedChallenge {
  id: string;
  purpose: OtpPurpose;
  email: string;
  payload: Record<string, unknown>;
  createdById: string | null;
}

/**
 * Check a code and mark the challenge verified.
 *
 * Deliberately does NOT consume it: the caller still has to perform the action
 * (create the user, add the membership). If that fails — a race on the unique
 * email, a database blip — the user can retry with the same code instead of
 * being forced to request a new one. `consumeOtpChallenge` closes it afterwards,
 * and it is the consume that makes replay impossible, not this call.
 */
export async function verifyOtpCode(challengeId: string, code: string): Promise<VerifiedChallenge> {
  const challenge = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge) {
    throw new OtpError('OTP_INVALID', 'That code is not valid. Please request a new one.');
  }
  if (challenge.consumedAt) {
    throw new OtpError('OTP_USED', 'That code has already been used. Please request a new one.');
  }
  if (challenge.expiresAt <= new Date()) {
    throw new OtpError('OTP_EXPIRED', 'That code has expired. Please request a new one.');
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    throw new OtpError(
      'OTP_ATTEMPTS_EXCEEDED',
      'Too many incorrect attempts. Please request a new code.',
      429,
    );
  }

  const expected = hashOtpCode(challenge.id, code);
  if (!safeEqualHex(expected, challenge.codeHash)) {
    // Count the failure. The update is atomic so concurrent guesses cannot all
    // read the same `attempts` value and slip past the cap.
    const bumped = await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true, maxAttempts: true },
    });
    if (bumped.attempts >= bumped.maxAttempts) {
      throw new OtpError(
        'OTP_ATTEMPTS_EXCEEDED',
        'Too many incorrect attempts. Please request a new code.',
        429,
      );
    }
    const left = bumped.maxAttempts - bumped.attempts;
    throw new OtpError(
      'OTP_INVALID',
      `That code is not correct. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`,
    );
  }

  if (!challenge.verifiedAt) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { verifiedAt: new Date() },
    });
  }

  return {
    id: challenge.id,
    purpose: challenge.purpose,
    email: challenge.email,
    payload: (challenge.payload ?? {}) as Record<string, unknown>,
    createdById: challenge.createdById,
  };
}

/**
 * Close a challenge after its action succeeded. Idempotent: a second call is a
 * no-op rather than an error, so a retry after a partial failure cannot 500.
 */
export async function consumeOtpChallenge(challengeId: string): Promise<void> {
  await prisma.otpChallenge.updateMany({
    where: { id: challengeId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
}

/** True when a resend for this address + purpose is still cooling down. */
export async function otpResendWaitMs(email: string, purpose: OtpPurpose): Promise<number> {
  const latest = await prisma.otpChallenge.findFirst({
    where: { email: normalizeEmail(email), purpose },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (!latest) return 0;
  const elapsed = Date.now() - latest.createdAt.getTime();
  return Math.max(0, OTP_RESEND_COOLDOWN_MS - elapsed);
}

/**
 * The purpose of a challenge, read without verifying or consuming it.
 *
 * Exists so a dispatcher can route to the right flow without duplicating the
 * verification work: each `complete*` function verifies and consumes its own
 * challenge, so the router only needs to know which one to call. Returns null
 * for an unknown id — the caller turns that into the same OTP_INVALID a wrong
 * code produces, so an attacker learns nothing from the difference.
 */
export async function peekOtpPurpose(challengeId: string): Promise<OtpPurpose | null> {
  const row = await prisma.otpChallenge.findUnique({
    where: { id: challengeId },
    select: { purpose: true },
  });
  return row?.purpose ?? null;
}

/** Maintenance: drop finished and expired challenges. */
export async function purgeExpiredOtpChallenges(): Promise<number> {
  const res = await prisma.otpChallenge.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return res.count;
}

// ─── Shared plumbing for the three flows ────────────────────────────────────

/** What a request endpoint hands back. `devCode` is set only by `devCodeFor`. */
export interface OtpRequestResult {
  challengeId: string;
  email: string;
  /** ISO string — the wire format the client counts down against. */
  expiresAt: string;
  resendAfterMs: number;
  /**
   * Only present when the mailer cannot actually deliver (log driver, not
   * production). Never rendered in the UI — see the note on `devCodeFor`.
   */
  devCode?: string;
}

/**
 * The code is echoed to the client only when nothing can actually deliver it.
 *
 * Two conditions, both required:
 *
 *   • never in production. A client must not be able to ask for the code, so
 *     this is decided by the environment and never by a request flag.
 *   • only when the mailer is the `log` driver — the case where the mail lands
 *     in storage/mail/ and nowhere else. As soon as a real driver (smtp or
 *     resend) is configured the code goes to the inbox and to nothing else:
 *     echoing it back would put it in the page, in the browser's network tab and
 *     in every proxy log on the way, which is the opposite of verifying that the
 *     recipient can read their mail.
 *
 * `tests/setup.ts` pins the log driver, so the suite and the browser harness
 * still receive it; a dev server running real SMTP does not.
 */
export function devCodeFor(code: string): { devCode?: string } {
  if (process.env.NODE_ENV === 'production') return {};
  const driver = (process.env.MAILER_DRIVER ?? 'log').toLowerCase();
  return driver === 'log' ? { devCode: code } : {};
}

export function otpRequestWire(issued: IssuedOtp, email: string): OtpRequestResult {
  return {
    challengeId: issued.challengeId,
    email,
    expiresAt: issued.expiresAt.toISOString(),
    resendAfterMs: issued.resendAfterMs,
    ...devCodeFor(issued.code),
  };
}

/**
 * Guard against a challenge issued for one purpose being redeemed at another
 * endpoint. The purposes share machinery but not authority — a SIGNUP challenge
 * must never be able to add a company manager.
 */
export function assertPurpose(challenge: VerifiedChallenge, expected: OtpPurpose): void {
  if (challenge.purpose !== expected) {
    throw new OtpError('OTP_INVALID', 'That code is not valid for this action.');
  }
}

/**
 * Send the code. Unlike the verification-link email, a failure here is NOT
 * swallowed: if the mail cannot be sent the user has no way to proceed, and a
 * silent success would leave them staring at a code prompt forever. The caller
 * lets the error surface so the client can offer a retry.
 */
export async function sendOtpEmail(opts: {
  to: string;
  name: string;
  code: string;
  purpose: OtpEmailPurpose;
  companyName?: string | null;
}): Promise<void> {
  const template = Templates.otpCode(opts.name, opts.code, opts.purpose, {
    companyName: opts.companyName ?? null,
    expiresInMinutes: Math.round(OTP_TTL_MS / 60_000),
  });
  await getMailer().send({ to: opts.to, ...template, tag: `otp-${opts.purpose.toLowerCase()}` });
}

export { OtpPurpose };
