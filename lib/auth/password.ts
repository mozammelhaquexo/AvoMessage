/**
 * Password hashing — bcryptjs, cost factor 12 per ARCHITECTURE.md §2.1.
 *
 * `BCRYPT_ROUNDS` env-overridable, never below 10. Passwords are never logged
 * and never returned in API responses (see services' publicUser()).
 */
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

const MIN_ROUNDS = 10;
const DEFAULT_ROUNDS = 12;

export function getBcryptRounds(): number {
  const raw = Number.parseInt(process.env.BCRYPT_ROUNDS ?? '', 10);
  if (Number.isFinite(raw) && raw >= MIN_ROUNDS) return raw;
  return DEFAULT_ROUNDS;
}

/** Hash a plaintext password. Throws if the password is empty. */
export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error('Cannot hash an empty password');
  return bcrypt.hash(password, getBcryptRounds());
}

/** Constant-time comparison of a plaintext password against a bcrypt hash. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}

// Lazily-created bcrypt hash of a random secret, used ONLY to burn the same
// CPU work as a real password comparison on the "unknown email" login path.
let dummyHash: Promise<string> | null = null;

/**
 * Timing-oracle mitigation for login: comparing against a real bcrypt hash
 * takes ~250ms, while rejecting an unknown email is instant — a measurable
 * difference that reveals account existence. Call this on the unknown-email
 * path so both outcomes cost the same. The result is discarded; it never
 * authenticates.
 */
export async function burnDummyPasswordCompare(password: string): Promise<void> {
  dummyHash ??= bcrypt.hash(randomBytes(32).toString('hex'), getBcryptRounds());
  await bcrypt.compare(password || 'x', await dummyHash);
}
