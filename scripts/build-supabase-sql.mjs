/**
 * build-supabase-sql.mjs — generate the root `supabase.sql` from prisma/migrations.
 *
 * WHY A GENERATOR. `prisma migrate deploy` needs a live CLI connection and the
 * migration files in order. On a fresh Supabase project the user wants ONE file
 * they can paste into the SQL Editor and run — with no CLI, no npm, no
 * connection string juggling. This script produces that file from the same
 * migration SQL Prisma already applied locally, so the two can never drift.
 *
 * WHAT MAKES IT SAFE TO RUN TWICE. Prisma's generated DDL is not idempotent
 * (`CREATE TABLE "User"` errors on the second run). Every statement is rewritten
 * to its guarded form:
 *
 *   CREATE TABLE          -> CREATE TABLE IF NOT EXISTS
 *   CREATE [UNIQUE] INDEX -> CREATE [UNIQUE] INDEX IF NOT EXISTS
 *   ALTER TABLE ADD COLUMN-> ADD COLUMN IF NOT EXISTS
 *   CREATE TYPE ... ENUM  -> wrapped, guarded on pg_type
 *   ALTER TABLE ADD CONSTRAINT -> wrapped, guarded on pg_constraint
 *   ALTER TYPE ... ADD VALUE   -> wrapped, guarded on pg_enum
 *
 * The file ends with the `_prisma_migrations` bookkeeping rows — the exact
 * sha256 checksums Prisma stored locally — so `prisma migrate deploy` afterwards
 * says "No pending migrations to apply" instead of trying to re-run everything.
 *
 * Usage:  node scripts/build-supabase-sql.mjs [--check]
 *   --check  fail (exit 1) if supabase.sql is out of date, without writing
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'prisma/migrations';
const OUT_FILE = 'supabase.sql';
const CHECK_ONLY = process.argv.includes('--check');

/**
 * Split a migration file into individual statements.
 *
 * A plain `split(';')` is wrong: semicolons appear inside single-quoted string
 * literals (enum labels, default values) and inside `--` comments. This walks
 * the text and only breaks on a semicolon seen outside both. `''` is treated as
 * an escaped quote, which is how Postgres escapes it.
 */
function splitStatements(text) {
  const out = [];
  let buf = '';
  let inQuote = false;
  let inComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inComment) {
      buf += ch;
      if (ch === '\n') inComment = false;
      continue;
    }
    if (inQuote) {
      buf += ch;
      if (ch === "'") {
        if (next === "'") {
          buf += next;
          i += 1;
        } else {
          inQuote = false;
        }
      }
      continue;
    }
    if (ch === '-' && next === '-') {
      inComment = true;
      buf += ch;
      continue;
    }
    if (ch === "'") {
      inQuote = true;
      buf += ch;
      continue;
    }
    if (ch === ';') {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** The first line of a statement that is not blank and not a `--` comment. */
function headLine(stmt) {
  for (const line of stmt.split('\n')) {
    const t = line.trim();
    if (t && !t.startsWith('--')) return t;
  }
  return '';
}

function indent(text, pad = '    ') {
  return text
    .split('\n')
    .map((l) => (l.trim() ? pad + l : l))
    .join('\n');
}

/** Wrap `body` in a DO block that only runs it when `guard` says it is absent. */
function guarded(guard, body) {
  return [
    'DO $avo$',
    'BEGIN',
    '  IF NOT EXISTS (',
    indent(guard, '    '),
    '  ) THEN',
    indent(body, '    '),
    '  END IF;',
    'END',
    '$avo$;',
  ].join('\n');
}

const pgTypeExists = (name) =>
  "SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace\n" +
  `WHERE t.typname = '${name}' AND n.nspname = 'public'`;

const pgConstraintExists = (constraint, table) =>
  'SELECT 1 FROM pg_constraint\n' +
  `WHERE conname = '${constraint}' AND conrelid = '"${table}"'::regclass`;

const pgEnumLabelExists = (type, label) =>
  'SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid\n' +
  `WHERE t.typname = '${type}' AND e.enumlabel = '${label}'`;

/** Rewrite one Prisma statement into an idempotent equivalent. */
function toIdempotent(stmt) {
  const head = headLine(stmt);

  // CREATE TYPE "X" AS ENUM (...)
  let m = /^CREATE TYPE "([^"]+)" AS ENUM/i.exec(head);
  if (m) return guarded(pgTypeExists(m[1]), `${stmt};`);

  // ALTER TYPE "X" ADD VALUE 'Y'
  m = /^ALTER TYPE "([^"]+)" ADD VALUE '([^']*)'/i.exec(head);
  if (m) return guarded(pgEnumLabelExists(m[1], m[2]), `${stmt};`);

  // ALTER TABLE "X" ADD CONSTRAINT "Y" ...
  m = /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"/i.exec(head);
  if (m) return guarded(pgConstraintExists(m[2], m[1]), `${stmt};`);

  // ALTER TABLE "X" ADD COLUMN "Y" ... (may be several, comma separated)
  if (/^ALTER TABLE "([^"]+)" ADD COLUMN/i.test(head)) {
    return `${stmt.replace(/ADD COLUMN\s+/gi, 'ADD COLUMN IF NOT EXISTS ')};`;
  }

  // Plain DDL with an IF NOT EXISTS form.
  //
  // The `m` flag matters: a chunk keeps the `-- CreateTable` comment Prisma
  // wrote above the statement, so an unanchored `/^CREATE TABLE /` would never
  // match and the guard would silently be skipped (the second run then dies with
  // `relation "User" already exists`).
  if (/^CREATE TABLE /im.test(head)) return `${stmt.replace(/^CREATE TABLE\s+/im, 'CREATE TABLE IF NOT EXISTS ')};`;
  if (/^CREATE UNIQUE INDEX /im.test(head)) return `${stmt.replace(/^CREATE UNIQUE INDEX\s+/im, 'CREATE UNIQUE INDEX IF NOT EXISTS ')};`;
  if (/^CREATE INDEX /im.test(head)) return `${stmt.replace(/^CREATE INDEX\s+/im, 'CREATE INDEX IF NOT EXISTS ')};`;

  // Anything else (none today) is emitted as-is. If a future migration adds a
  // statement shape that is not idempotent, `npm run check:supabase-sql` will
  // not catch it — the double-run verification in the test suite will.
  return `${stmt};`;
}

// --- collect migrations -----------------------------------------------------

const dirs = readdirSync(MIGRATIONS_DIR)
  .filter((d) => statSync(join(MIGRATIONS_DIR, d)).isDirectory())
  .sort();

if (dirs.length === 0) {
  console.error('No migrations found in ' + MIGRATIONS_DIR);
  process.exit(1);
}

const migrations = dirs.map((name) => {
  const sql = readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
  return {
    name,
    checksum: createHash('sha256').update(sql).digest('hex'),
    statements: splitStatements(sql).map(toIdempotent),
  };
});

const totalStatements = migrations.reduce((n, m) => n + m.statements.length, 0);

// --- emit -------------------------------------------------------------------

const HEADER = `-- =============================================================================
-- AvoMessage - complete database schema for Supabase / PostgreSQL
-- =============================================================================
--
-- HOW TO RUN (once, on a brand new project)
--   1. Supabase Dashboard -> SQL Editor -> New query
--   2. Paste this whole file, press Run.
--   Or from a terminal:  psql "$DATABASE_URL" -f supabase.sql
--
-- বাংলা: Supabase-এর SQL Editor-এ এই ফাইলটা পুরোটা পেস্ট করে Run চাপলেই
--        ডাটাবেস সম্পূর্ণ তৈরি হয়ে যাবে। ভুলে দুইবার Run করলেও কোনো এরর আসবে না।
--
-- WHAT IT DOES
--   1. Creates every enum, table, index, primary key and foreign key the app
--      needs (${migrations.length} migrations, ${totalStatements} statements).
--   2. Every statement is guarded, so a second run is a no-op instead of an error.
--   3. Records the Prisma migration bookkeeping rows in "_prisma_migrations"
--      with the exact checksums Prisma expects, so a later
--      \`npx prisma migrate deploy\` reports "No pending migrations to apply"
--      rather than replaying the schema.
--   4. Enables Row Level Security on every table. See the last section: this is
--      what stops the Supabase anon/public API key from reading password hashes.
--
-- GENERATED FILE - do not edit by hand.
-- Regenerate with:  node scripts/build-supabase-sql.mjs
-- Source of truth:  prisma/migrations/*/migration.sql
-- =============================================================================
`;

const parts = [HEADER];

for (const mig of migrations) {
  parts.push(
    [
      '',
      '-- -----------------------------------------------------------------------------',
      `-- migration ${mig.name}  (${mig.statements.length} statements)`,
      `-- checksum ${mig.checksum}`,
      '-- -----------------------------------------------------------------------------',
      '',
    ].join('\n'),
  );
  for (const s of mig.statements) parts.push(s + '\n');
}

parts.push(`
-- =============================================================================
-- Prisma migration bookkeeping
-- =============================================================================
-- Prisma decides whether the schema is current by comparing the checksums in
-- this table against prisma/migrations/*/migration.sql. Writing the rows here
-- makes the SQL Editor run equivalent to \`prisma migrate deploy\`, so the CLI
-- will not try to replay DDL that already exists.
--
-- The checksums below are sha256 of each migration.sql, byte for byte - the same
-- values the local development database holds.

CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                  VARCHAR(36)  PRIMARY KEY NOT NULL,
    "checksum"            VARCHAR(64)  NOT NULL,
    "finished_at"         TIMESTAMPTZ,
    "migration_name"      VARCHAR(255) NOT NULL,
    "logs"                TEXT,
    "rolled_back_at"      TIMESTAMPTZ,
    "started_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER      NOT NULL DEFAULT 0
);
`);

for (const mig of migrations) {
  parts.push(`
INSERT INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT gen_random_uuid()::text, '${mig.checksum}', now(), '${mig.name}', NULL, NULL, now(), 1
WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '${mig.name}'
);
`);
}

parts.push(`
-- =============================================================================
-- Row Level Security
-- =============================================================================
-- WHY THIS MATTERS. Supabase exposes the \`public\` schema over its REST API to
-- anyone holding the anon/public key - and that key is shipped to the browser.
-- With RLS switched off, that key can SELECT every row in the database,
-- including "User"."passwordHash" and every session row.
--
-- Enabling RLS with NO policies attached denies all access to non-owner roles
-- (anon, authenticated) while leaving the table OWNER untouched. Prisma connects
-- as the Supabase \`postgres\` role, which owns these tables, so the application
-- keeps full read/write access. Nothing in the app uses the Supabase client
-- libraries, so no policy is needed.
--
-- IMPORTANT: do not add FORCE ROW LEVEL SECURITY here. Forcing it would apply
-- RLS to the owner as well and lock the application out of its own tables.

DO $avo$
DECLARE
    t record;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    END LOOP;
END
$avo$;
`);

parts.push(`
-- =============================================================================
-- Sanity check - the last result set is what the SQL Editor displays.
-- Expect: tables = 39 (38 app tables + _prisma_migrations), enums = 20,
--         foreign_keys = 64, migrations = ${migrations.length},
--         tables_without_rls = 0
-- =============================================================================

SELECT
    (SELECT count(*) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE')                       AS tables,
    (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typtype = 'e' AND n.nspname = 'public')                                     AS enums,
    (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.contype = 'f' AND n.nspname = 'public')                                     AS foreign_keys,
    (SELECT count(*) FROM "_prisma_migrations" WHERE "rolled_back_at" IS NULL)            AS migrations,
    (SELECT count(*) FROM pg_tables
      WHERE schemaname = 'public' AND rowsecurity = false)                                AS tables_without_rls;
`);

const output = parts.join('\n').replace(/\n{4,}/g, '\n\n\n');

if (CHECK_ONLY) {
  const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf8') : '';
  if (current !== output) {
    console.error(`${OUT_FILE} is out of date. Run: node scripts/build-supabase-sql.mjs`);
    process.exit(1);
  }
  console.log(`${OUT_FILE} is up to date.`);
} else {
  writeFileSync(OUT_FILE, output, 'utf8');
  console.log(
    `Wrote ${OUT_FILE}: ${migrations.length} migrations, ${totalStatements} statements, ` +
      `${output.length} bytes.`,
  );
}
