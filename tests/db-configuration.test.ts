/**
 * A misconfigured deployment must say so.
 *
 * The symptom that started this: signing in to the deployed app returned
 * "Internal server error" — a 500 with no cause, from a request that had not
 * even reached the database. The operator had nothing to act on.
 *
 * `lib/db.ts` now throws `DatabaseNotConfiguredError`, which carries the
 * `{ status, code, message }` shape `lib/api.ts` recognises structurally, so the
 * client gets 503 `DB_NOT_CONFIGURED` and a sentence naming the env var.
 *
 * The import-safety half of the fix (importing `lib/db` with no DATABASE_URL
 * must not throw) is proved separately in the live probe, because a module is
 * only evaluated once per process and this suite runs with a real DATABASE_URL.
 */
import { describe, expect, it } from 'vitest';
import { DatabaseNotConfiguredError } from '@/lib/db';
import { toErrorResponse } from '@/lib/api';

describe('an unconfigured database', () => {
  it('answers 503 DB_NOT_CONFIGURED, not an opaque 500', async () => {
    const res = toErrorResponse(new DatabaseNotConfiguredError('DATABASE_URL is not set.'));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('DB_NOT_CONFIGURED');
    expect(body.error.message).toContain('DATABASE_URL');
  });

  it('satisfies the structural check lib/api.ts uses, so no import cycle is needed', () => {
    const e = new DatabaseNotConfiguredError('anything');
    // `isCodedError` accepts any object with these three fields — that is what
    // lets lib/db stay free of application imports.
    expect(typeof e.status).toBe('number');
    expect(typeof e.code).toBe('string');
    expect(typeof e.message).toBe('string');
    expect(e).toBeInstanceOf(Error);
  });

  it('carries no connection details', () => {
    const e = new DatabaseNotConfiguredError(
      'The database is not configured. DATABASE_URL is not set.',
    );
    expect(e.message).not.toMatch(/postgres(ql)?:\/\//);
  });
});
