/**
 * Email-verification + password-reset tokens (ARCHITECTURE.md §2.4).
 *
 * - 32-byte `crypto.randomBytes`, hex-encoded for the email link.
 * - Only the SHA-256 hash is stored (`VerificationToken.tokenHash`).
 * - Single-use (`usedAt`), expiring (24h verification / 1h reset).
 * - Consumption is transactional: mark used + apply effect atomically, so a
 *   token can never be redeemed twice even under concurrency.
 */
import { createHash, randomBytes } from 'node:crypto';
import { TokenType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { HttpError } from '@/lib/api';

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export interface IssuedToken {
  /** Raw token to embed in the email link. Never stored, never logged. */
  raw: string;
  expiresAt: Date;
}

/** Issue a fresh single-use token, deleting any prior unused ones of that type. */
export async function issueToken(userId: string, type: TokenType): Promise<IssuedToken> {
  const raw = randomBytes(32).toString('hex');
  const ttl = type === TokenType.EMAIL_VERIFICATION ? EMAIL_VERIFICATION_TTL_MS : PASSWORD_RESET_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { userId, type, usedAt: null } }),
    prisma.verificationToken.create({
      data: { userId, tokenHash: hashToken(raw), type, expiresAt },
    }),
  ]);
  return { raw, expiresAt };
}

export class TokenError extends HttpError {
  constructor(code: 'TOKEN_INVALID' | 'TOKEN_EXPIRED' | 'TOKEN_USED', message: string) {
    super(code === 'TOKEN_INVALID' ? 400 : 400, code, message);
  }
}

export interface ConsumedToken {
  userId: string;
}

/**
 * Atomically consume a token: validates existence, single-use and expiry,
 * marks `usedAt`. Returns the owning user id. Throws TOKEN_INVALID /
 * TOKEN_EXPIRED / TOKEN_USED.
 */
export async function consumeToken(raw: string, type: TokenType): Promise<ConsumedToken> {
  const tokenHash = hashToken(raw);
  return prisma.$transaction(async (tx) => {
    const token = await tx.verificationToken.findUnique({ where: { tokenHash } });
    if (!token || token.type !== type) {
      throw new TokenError('TOKEN_INVALID', 'Invalid token');
    }
    if (token.usedAt) {
      throw new TokenError('TOKEN_USED', 'This token has already been used');
    }
    if (token.expiresAt <= new Date()) {
      throw new TokenError('TOKEN_EXPIRED', 'This token has expired');
    }
    await tx.verificationToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });
    return { userId: token.userId };
  });
}

/** True when the user requested a token of this type within the cooldown. */
export async function isResendCooldowned(userId: string, type: TokenType): Promise<boolean> {
  const latest = await prisma.verificationToken.findFirst({
    where: { userId, type },
    orderBy: { createdAt: 'desc' },
  });
  return !!latest && Date.now() - latest.createdAt.getTime() < VERIFICATION_RESEND_COOLDOWN_MS;
}

/** Maintenance: purge expired tokens (called by the in-process scheduler). */
export async function purgeExpiredTokens(): Promise<number> {
  const res = await prisma.verificationToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return res.count;
}
