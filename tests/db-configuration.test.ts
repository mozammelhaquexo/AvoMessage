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

/**
 * A variable that IS set but unusable is the harder half of the same problem.
 *
 * `DATABASE_URL` present and pointing at the wrong host, the wrong pooler
 * region, a database where the schema was never applied, or a role without
 * privileges all produced the same answer as a genuine bug: 500 INTERNAL_ERROR.
 * These map the driver's own codes onto a 503 an operator can act on.
 *
 * Both layers are covered because either can surface through the pg driver
 * adapter: Prisma's `P####` codes and the raw Postgres SQLSTATE / Node network
 * codes.
 */
describe('a database that is configured but unusable', () => {
  /** Silence the deliberate console.error in the branch under test. */
  function quiet<T>(fn: () => T): T {
    const original = console.error;
    console.error = () => {};
    try {
      return fn();
    } finally {
      console.error = original;
    }
  }

  async function responseFor(e: unknown) {
    return quiet(() => toErrorResponse(e));
  }

  it.each([
    ['P2021 (table missing)', { code: 'P2021' }, 'DB_SCHEMA_MISSING'],
    ['P2022 (column missing)', { code: 'P2022' }, 'DB_SCHEMA_MISSING'],
    ['42P01 (undefined_table)', { code: '42P01' }, 'DB_SCHEMA_MISSING'],
    ['P1001 (cannot reach host)', { code: 'P1001' }, 'DB_UNREACHABLE'],
    ['P1000 (rejected credentials)', { code: 'P1000' }, 'DB_AUTH_FAILED'],
    ['28P01 (invalid_password)', { code: '28P01' }, 'DB_AUTH_FAILED'],
    ['42501 (insufficient_privilege)', { code: '42501' }, 'DB_PERMISSION_DENIED'],
    ['ENOTFOUND (host not resolvable)', { code: 'ENOTFOUND' }, 'DB_UNREACHABLE'],
    ['ECONNREFUSED (refused)', { code: 'ECONNREFUSED' }, 'DB_UNREACHABLE'],
    ['SELF_SIGNED_CERT_IN_CHAIN (TLS)', { code: 'SELF_SIGNED_CERT_IN_CHAIN' }, 'DB_UNREACHABLE'],
  ])('%s answers 503 %s', async (_label, error, expected) => {
    const res = await responseFor(Object.assign(new Error('driver noise'), error));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe(expected);
    // A sentence an operator can act on, never the driver's own message.
    expect(body.error.message).not.toBe('driver noise');
    expect(body.error.message.length).toBeGreaterThan(20);
  });

  it('names the missing-schema remedy, because that is the actionable one', async () => {
    const res = await responseFor(Object.assign(new Error('x'), { code: 'P2021' }));
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/supabase\.sql|migrate deploy/);
  });

  it('names the pooler TLS remedy', async () => {
    const res = await responseFor(
      Object.assign(new Error('x'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }),
    );
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('sslmode=no-verify');
  });

  it('still answers 409 for a unique-constraint violation, which is also a P-code', async () => {
    // P2002 must not be swallowed by the database-failure branch: it is a real
    // conflict the client branches on, not a broken deployment.
    const res = await responseFor({ code: 'P2002', meta: { target: 'email' } });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');
  });

  it('leaves an unrecognised error as an opaque 500', async () => {
    const res = await responseFor(Object.assign(new Error('boom'), { code: 'P9999' }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('never echoes a connection string out of a driver message', async () => {
    // The messages are fixed strings, so even a driver error that embeds
    // credentials cannot reach the client.
    const leaked = Object.assign(
      new Error('connect ECONNREFUSED postgresql://postgres:hunter2@db.example.co:5432/postgres'),
      { code: 'ECONNREFUSED' },
    );
    const res = await responseFor(leaked);
    const text = await res.text();
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('db.example.co');
  });
});

