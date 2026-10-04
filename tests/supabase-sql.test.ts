/**
 * supabase.sql must stay in lockstep with prisma/migrations.
 *
 * supabase.sql is generated (scripts/build-supabase-sql.mjs) and is the only
 * thing a fresh Supabase project needs — the user pastes it into the SQL Editor
 * and presses Run. That makes silent drift expensive: add a migration, forget to
 * regenerate, and the deployed database is missing a table while everything
 * local passes.
 *
 * These assertions are structural rather than a byte-for-byte diff of the
 * generator output, so they stay readable when the generator's formatting
 * changes while still failing the moment a statement loses its guard or a
 * migration stops being represented.
 *
 * The end-to-end proof (apply twice, diff the schema against the local database)
 * lives in scripts/verify-supabase-sql.mjs and needs a live Postgres.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase.sql', 'utf8');

const migrationDirs = readdirSync('prisma/migrations')
  .filter((d) => statSync(join('prisma/migrations', d)).isDirectory())
  .sort();

const migrations = migrationDirs.map((name) => {
  const body = readFileSync(join('prisma/migrations', name, 'migration.sql'), 'utf8');
  return { name, body, checksum: createHash('sha256').update(body).digest('hex') };
});

/** All occurrences of a regex group 1, as a sorted unique list. */
function collect(source: string, re: RegExp): string[] {
  return [...source.matchAll(re)].map((m) => m[1]).sort();
}

describe('supabase.sql', () => {
  it('represents every migration on disk', () => {
    expect(migrations.length).toBeGreaterThan(0);
    for (const m of migrations) {
      expect(sql, `migration ${m.name} missing from supabase.sql`).toContain(m.name);
    }
  });

  it('records the sha256 checksum Prisma expects for each migration', () => {
    for (const m of migrations) {
      expect(sql, `checksum for ${m.name} missing`).toContain(m.checksum);
      // Prisma's bookkeeping row pairs the checksum with the migration name.
      expect(sql).toMatch(
        new RegExp(
          `INSERT INTO "_prisma_migrations"[\\s\\S]{0,400}'${m.checksum}'[\\s\\S]{0,200}'${m.name}'`,
        ),
      );
    }
  });

  it('makes every CREATE TABLE idempotent', () => {
    const total = collect(
      migrations.map((m) => m.body).join('\n'),
      /^CREATE TABLE /gim,
    ).length;
    const guarded = collect(sql, /^CREATE TABLE IF NOT EXISTS /gim).length;
    expect(total).toBeGreaterThan(0);
    // +1: the file also creates "_prisma_migrations" itself.
    expect(guarded).toBe(total + 1);
    // An unguarded one would blow up on the second run.
    expect(sql).not.toMatch(/^CREATE TABLE "/m);
  });

  it('makes every CREATE INDEX idempotent', () => {
    const body = migrations.map((m) => m.body).join('\n');
    const plain = collect(body, /^CREATE INDEX /gim).length;
    const unique = collect(body, /^CREATE UNIQUE INDEX /gim).length;
    expect(collect(sql, /^CREATE INDEX IF NOT EXISTS /gim).length).toBe(plain);
    expect(collect(sql, /^CREATE UNIQUE INDEX IF NOT EXISTS /gim).length).toBe(unique);
    expect(sql).not.toMatch(/^CREATE (UNIQUE )?INDEX "/m);
  });

  it('guards every CREATE TYPE behind a pg_type check', () => {
    const types = collect(migrations.map((m) => m.body).join('\n'), /^CREATE TYPE "([^"]+)" AS ENUM/gim);
    expect(types.length).toBeGreaterThan(0);
    for (const t of types) {
      expect(sql, `CREATE TYPE "${t}" is unguarded`).toContain(`t.typname = '${t}'`);
    }
    // Column-anchored: inside a DO block the statement is indented, so an
    // unindented CREATE TYPE is the only thing that can still reach the server
    // unprotected.
    expect(sql).not.toMatch(/^CREATE TYPE "/m);
  });

  it('guards every ADD CONSTRAINT behind a pg_constraint check', () => {
    const constraints = collect(
      migrations.map((m) => m.body).join('\n'),
      /^ALTER TABLE "[^"]+" ADD CONSTRAINT "([^"]+)"/gim,
    );
    expect(constraints.length).toBeGreaterThan(0);
    for (const c of constraints) {
      expect(sql, `constraint ${c} is unguarded`).toContain(`conname = '${c}'`);
    }
    expect(sql).not.toMatch(/^ALTER TABLE "[^"]+" ADD CONSTRAINT/m);
  });

  it('guards every ALTER TYPE ... ADD VALUE behind a pg_enum check', () => {
    const body = migrations.map((m) => m.body).join('\n');
    const adds = [...body.matchAll(/^ALTER TYPE "([^"]+)" ADD VALUE '([^']*)'/gim)];
    for (const [, type, label] of adds) {
      expect(sql, `enum value ${type}.${label} is unguarded`).toContain(`e.enumlabel = '${label}'`);
    }
    expect(sql).not.toMatch(/^ALTER TYPE "[^"]+" ADD VALUE/m);
  });

  it('makes every ADD COLUMN idempotent', () => {
    const body = migrations.map((m) => m.body).join('\n');
    const adds = collect(body, /ADD COLUMN\s+/gi).length;
    expect(collect(sql, /ADD COLUMN IF NOT EXISTS\s+/gi).length).toBe(adds);
    expect(sql).not.toMatch(/ADD COLUMN\s+(?!IF NOT EXISTS)/);
  });

  it('enables Row Level Security without forcing it on the owner', () => {
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    // FORCE would apply RLS to the table owner — the role Prisma connects as —
    // and lock the application out of its own tables. The header explains this,
    // so only non-comment lines count.
    const statement = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(statement).not.toContain('FORCE ROW LEVEL SECURITY');
  });

  it('leaves no statement without a terminating semicolon', () => {
    // A DO block whose closing tag lost its semicolon produces the opaque
    // "syntax error at or near DO"; assert the shape instead of discovering it
    // against a live database.
    const opened = (sql.match(/DO \$avo\$/g) ?? []).length;
    const closed = (sql.match(/\$avo\$;/g) ?? []).length;
    expect(opened).toBeGreaterThan(0);
    expect(closed).toBe(opened);
  });
});
