/**
 * verify-supabase-sql.mjs — prove supabase.sql is correct and re-runnable.
 *
 * WHAT IT PROVES, IN ORDER
 *   1. supabase.sql applies cleanly to an empty database.
 *   2. Applying it a SECOND time is a no-op, not an error. This is the property
 *      the user actually cares about ("paste it in the SQL Editor and press Run"),
 *      and it is the one a plain `prisma migrate` file does NOT have.
 *   3. The resulting schema is byte-for-byte equivalent to the schema Prisma
 *      built locally: same columns, types, nullability, defaults, constraints,
 *      indexes, sequences and enum labels in the same order.
 *   4. The "_prisma_migrations" bookkeeping rows carry the same checksums as the
 *      local database, so `prisma migrate deploy` will agree the DB is current.
 *
 * A claim like "the SQL file works" is not verifiable by reading it. This runs
 * it, twice, against a real Postgres, and diffs the result.
 *
 * Usage:  node scripts/verify-supabase-sql.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const SCRATCH_DB = 'avo_supabase_sql_check';
const SOURCE_DB = 'avomessage_dev';

// .env is not loaded automatically for a plain node script.
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}

const baseUrl = new URL(process.env.DATABASE_URL);
const withDb = (name) => {
  const u = new URL(baseUrl.toString());
  u.pathname = '/' + name;
  return u.toString();
};

let passed = 0;
let failed = 0;
function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`);
  }
}

async function connect(url) {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
}

// --- schema fingerprint -----------------------------------------------------

const COLUMNS = `
  SELECT table_name, ordinal_position, column_name, data_type, udt_name,
         is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position`;

const CONSTRAINTS = `
  SELECT c.conname, t.relname AS table_name, c.contype,
         pg_get_constraintdef(c.oid) AS def
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
  ORDER BY t.relname, c.conname`;

const INDEXES = `
  SELECT tablename, indexname, indexdef
  FROM pg_indexes WHERE schemaname = 'public'
  ORDER BY tablename, indexname`;

const ENUMS = `
  SELECT t.typname, e.enumlabel, e.enumsortorder
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
  ORDER BY t.typname, e.enumsortorder`;

const SEQUENCES = `
  SELECT sequence_name FROM information_schema.sequences
  WHERE sequence_schema = 'public' ORDER BY sequence_name`;

const MIGRATIONS = `
  SELECT migration_name, checksum, applied_steps_count
  FROM "_prisma_migrations" WHERE rolled_back_at IS NULL
  ORDER BY migration_name`;

async function fingerprint(client) {
  // Sequential on purpose: pg deprecates overlapping queries on one client, and
  // Promise.all here would fire all six at once.
  return {
    columns: (await client.query(COLUMNS)).rows,
    constraints: (await client.query(CONSTRAINTS)).rows,
    indexes: (await client.query(INDEXES)).rows,
    enums: (await client.query(ENUMS)).rows,
    sequences: (await client.query(SEQUENCES)).rows,
    migrations: (await client.query(MIGRATIONS)).rows,
  };
}

/** Print the first few differing entries so a failure is actionable. */
function diff(label, a, b) {
  const sa = JSON.stringify(a, null, 1).split('\n');
  const sb = JSON.stringify(b, null, 1).split('\n');
  const out = [];
  for (let i = 0; i < Math.max(sa.length, sb.length) && out.length < 8; i += 1) {
    if (sa[i] !== sb[i]) out.push(`line ${i + 1}:\n          local : ${sa[i]}\n          sql   : ${sb[i]}`);
  }
  return out.length ? `${label} differs:\n        ${out.join('\n        ')}` : `${label} differs`;
}

// --- run --------------------------------------------------------------------

const sql = readFileSync('supabase.sql', 'utf8');
const migrationCount = readdirSync('prisma/migrations').filter((d) =>
  statSync(join('prisma/migrations', d)).isDirectory(),
).length;

console.log(`supabase.sql: ${sql.length} bytes, ${sql.split('\n').length} lines\n`);

console.log('1. create a scratch database');
const admin = await connect(withDb('postgres'));
await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
check('scratch database created', true);

const scratch = await connect(withDb(SCRATCH_DB));

console.log('\n2. apply supabase.sql to the empty database');
try {
  await scratch.query(sql);
  check('first run applied without error', true);
} catch (e) {
  check('first run applied without error', false, String(e.message));
}

console.log('\n3. apply it AGAIN (idempotency)');
try {
  await scratch.query(sql);
  check('second run applied without error', true);
} catch (e) {
  check('second run applied without error', false, String(e.message));
}

console.log('\n4. compare against the schema Prisma built locally');
const source = await connect(withDb(SOURCE_DB));
const local = await fingerprint(source);
const generated = await fingerprint(scratch);

check(
  `columns (${local.columns.length} local / ${generated.columns.length} from sql)`,
  JSON.stringify(local.columns) === JSON.stringify(generated.columns),
  diff('columns', local.columns, generated.columns),
);
check(
  `constraints (${local.constraints.length} / ${generated.constraints.length})`,
  JSON.stringify(local.constraints) === JSON.stringify(generated.constraints),
  diff('constraints', local.constraints, generated.constraints),
);
check(
  `indexes (${local.indexes.length} / ${generated.indexes.length})`,
  JSON.stringify(local.indexes) === JSON.stringify(generated.indexes),
  diff('indexes', local.indexes, generated.indexes),
);
check(
  `enum labels (${local.enums.length} / ${generated.enums.length})`,
  JSON.stringify(local.enums) === JSON.stringify(generated.enums),
  diff('enums', local.enums, generated.enums),
);
check(
  `sequences (${local.sequences.length} / ${generated.sequences.length})`,
  JSON.stringify(local.sequences) === JSON.stringify(generated.sequences),
  diff('sequences', local.sequences, generated.sequences),
);

console.log('\n5. Prisma migration bookkeeping');
check(
  `exactly ${migrationCount} migration rows recorded`,
  generated.migrations.length === migrationCount,
  `got ${generated.migrations.length}`,
);
check(
  'checksums match the local database (so migrate deploy agrees)',
  JSON.stringify(local.migrations) === JSON.stringify(generated.migrations),
  diff('migrations', local.migrations, generated.migrations),
);

console.log('\n6. Row Level Security');
const rls = await scratch.query(
  `SELECT count(*)::int AS off FROM pg_tables WHERE schemaname='public' AND rowsecurity = false`,
);
check('every table has RLS enabled', rls.rows[0].off === 0, `${rls.rows[0].off} table(s) without RLS`);

console.log('\n7. the sanity-check query at the end of the file returns a result');
const summary = await scratch.query(`
  SELECT
    (SELECT count(*)::int FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE') AS tables,
    (SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE t.typtype='e' AND n.nspname='public') AS enums,
    (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE c.contype='f' AND n.nspname='public') AS foreign_keys,
    (SELECT count(*)::int FROM "_prisma_migrations" WHERE rolled_back_at IS NULL) AS migrations,
    (SELECT count(*)::int FROM pg_tables WHERE schemaname='public' AND rowsecurity=false) AS tables_without_rls`);
console.log('        ' + JSON.stringify(summary.rows[0]));

console.log('\n8. clean up');
await scratch.end();
await source.end();
await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
await admin.end();
check('scratch database dropped', true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
