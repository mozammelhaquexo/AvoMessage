/**
 * Vitest global setup: load .env (vitest doesn't do it automatically), pin the
 * mailer to the log driver so no test can send real email, and disable the
 * in-memory rate limiter so tests never flake on budgets.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

process.env.RATE_LIMIT_DISABLED = '1';

/**
 * Force the log mailer, unconditionally and AFTER .env is loaded.
 *
 * This is not tidiness — it is the difference between a test run and a few
 * hundred real emails. The suite creates users with `@example.com` addresses,
 * and .env points MAILER_DRIVER at real Gmail SMTP so the dev server sends
 * actual OTP mail. Without this line every signup/member/manager test would
 * open an SMTP connection to Gmail, send to a non-existent address, and burn
 * the account's sending quota (Gmail rate-limits and can disable an account
 * for it). The `key in process.env` guard in the loader above would not help:
 * .env sets MAILER_DRIVER, so it is already present by the time we get here.
 */
process.env.MAILER_DRIVER = 'log';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set to run the API tests');
}
