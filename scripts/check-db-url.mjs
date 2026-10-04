/**
 * check-db-url.mjs — "why can't this deployment use its database?"
 *
 * Answers that question in one command, layer by layer, instead of by inferring
 * it from HTTP status codes. Written after a deployment spent a long time
 * answering every write with `500 INTERNAL_ERROR` while `/api/health` reported
 * `ok` — the cause turned out to be stacked, independent problems, none of
 * which the application could describe:
 *
 *   1. the connection string named the wrong Supavisor region, so the pooler
 *      answered "tenant/user ... not found";
 *   2. the correct host then failed TLS chain verification, because
 *      node-postgres now treats `sslmode=require` as `verify-full` while
 *      Supabase's pooler presents a self-signed root;
 *   3. and `/api/health` only ran `SELECT 1`, which succeeds on a database
 *      where the migrations were never applied.
 *
 * Each layer is reported independently, so two problems are not mistaken for
 * one. The verdict names the same error code the API would return for that
 * failure (see DB_FAILURES in lib/api.ts).
 *
 * Usage:
 *   node scripts/check-db-url.mjs                          # DATABASE_URL from env/.env
 *   node scripts/check-db-url.mjs "postgresql://..."       # or an explicit URL
 *   npm run db:check
 *
 * Exit code 0 when the database is usable by the application, 1 otherwise.
 * The password is never printed.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const MIGRATIONS_DIR = 'prisma/migrations';

// ─── input ──────────────────────────────────────────────────────────────────

/** Minimal .env reader — enough for a single unquoted/quoted assignment. */
function fromDotEnv(key) {
  if (!existsSync('.env')) return undefined;
  const line = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${key}=`));
  if (!line) return undefined;
  return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
}

const connectionString = process.argv[2] ?? process.env.DATABASE_URL ?? fromDotEnv('DATABASE_URL');

if (!connectionString) {
  console.error('No connection string. Pass one as an argument, or set DATABASE_URL.');
  process.exit(1);
}

const REDACTED = connectionString.replace(/:\/\/([^:@/]+):[^@/]+@/, '://$1:<redacted>@');

let target;
try {
  target = new URL(connectionString);
} catch {
  console.error(`Not a parseable URL: ${REDACTED}`);
  process.exit(1);
}

const host = target.hostname;
const port = Number(target.port || 5432);
const database = target.pathname.replace(/^\//, '') || 'postgres';
const user = decodeURIComponent(target.username);
const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';

const findings = [];
function note(level, text) {
  findings.push({ level, text });
  console.log(`${level === 'ok' ? '  ok  ' : level === 'warn' ? ' warn ' : ' FAIL '} ${text}`);
}

/** Set (replacing, not appending a second) `sslmode` on the URL. */
function withSslMode(cs, mode) {
  const u = new URL(cs);
  u.searchParams.set('sslmode', mode);
  return u.toString();
}

console.log(`\nTarget: ${REDACTED}`);
console.log(
  `        host=${host} port=${port} db=${database} user=${user} sslmode=${target.searchParams.get('sslmode') ?? '(unset)'}\n`,
);

// ─── 1. DNS ─────────────────────────────────────────────────────────────────

let addresses = [];
try {
  addresses = (await lookup(host, { all: true })).map((a) => a.address);
} catch (err) {
  note('fail', `[1/5] DNS      ${host} does not resolve (${err.code ?? err.message}) -> DB_UNREACHABLE`);
  process.exit(report());
}

const v4 = addresses.filter((a) => a.includes('.'));
note('ok', `[1/5] DNS      ${host} -> ${addresses.join(', ')}`);
if (v4.length === 0 && !isLocal) {
  note(
    'warn',
    '[1/5] DNS      IPv6-only. IPv4-only hosts (Vercel serverless, most CI) cannot reach it. ' +
      'Supabase\'s direct db.<ref>.supabase.co is IPv6-only — use the pooler host instead.',
  );
}

// ─── 2-4. TCP, TLS and auth, reported independently ─────────────────────────

async function attempt(cs) {
  const client = new pg.Client({ connectionString: cs, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    return { client, error: null };
  } catch (err) {
    await client.end().catch(() => {});
    return { client: null, error: err };
  }
}

const isCertError = (err) =>
  /SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE/.test(
    err?.code ?? err?.message ?? '',
  );

let { client, error } = await attempt(connectionString);

// Supabase's pooler presents a self-signed root, so a chain-verifying sslmode
// is expected to fail here. Retry with verification off and report the TLS
// layer separately — a later failure (wrong password, missing schema) is a
// *different* problem and must not be mistaken for this one.
let certFailed = false;
if (error && isCertError(error)) {
  certFailed = true;
  const retry = await attempt(withSslMode(connectionString, 'no-verify'));
  if (retry.client) {
    client = retry.client;
    error = null;
  } else {
    error = retry.error;
  }
}

if (certFailed) {
  note(
    'fail',
    '[3/5] TLS      certificate chain not verifiable (SELF_SIGNED_CERT_IN_CHAIN). ' +
      'node-postgres treats sslmode=require as verify-full; Supabase\'s pooler needs ' +
      '?sslmode=no-verify.',
  );
}

if (error) {
  const code = error.code ?? '?';
  const map = {
    ENOTFOUND: 'DB_UNREACHABLE — the host does not resolve',
    EAI_AGAIN: 'DB_UNREACHABLE — the host does not resolve',
    ECONNREFUSED: 'DB_UNREACHABLE — nothing listening on that host:port',
    ETIMEDOUT: 'DB_UNREACHABLE — connection timed out',
    '28P01': 'DB_AUTH_FAILED — wrong password',
    '28000': 'DB_AUTH_FAILED — the server rejected the credentials',
    '3D000': 'DB_UNREACHABLE — that database does not exist',
    '42501': 'DB_PERMISSION_DENIED — the role lacks privileges',
  };
  note('fail', `[2-4/5] CONNECT failed: ${code}: ${String(error.message).split('\n')[0]}`);
  if (/not found/i.test(error.message ?? '')) {
    note(
      'warn',
      'A Supavisor "tenant/user not found" means this pooler REGION does not host the project. ' +
        'The pooler host is region-scoped (aws-{0,1}-<region>.pooler.supabase.com) — copy the exact ' +
        'one from Supabase -> Project Settings -> Database -> Connection string.',
    );
    note('fail', 'verdict: DB_UNREACHABLE — wrong pooler region for this project');
  } else {
    note('fail', `verdict: ${map[code] ?? 'unknown failure'}`);
  }
  process.exit(report());
}

note('ok', `[2/5] TCP      ${host}:${port} connected`);

// Ask the server rather than guessing from the URL: `pg` does not enable TLS
// unless the connection string says to, so a remote host can still be plaintext.
const { rows: sslRows } = await client.query(
  'SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()',
);
const sslOn = sslRows.length > 0 && sslRows[0].ssl === true;
if (sslOn) {
  note('ok', `[3/5] TLS      encrypted (${sslRows[0].version})`);
} else if (isLocal) {
  note('ok', '[3/5] TLS      not used (local connection)');
} else {
  note(
    'warn',
    '[3/5] TLS      NOT encrypted — no sslmode in the URL. Add ?sslmode=no-verify ' +
      '(Supabase\'s pooler presents a self-signed root, so verify-full rejects it).',
  );
}

note('ok', `[4/5] AUTH     authenticated as ${user}`);

// ─── 5. schema — the probe /api/health was missing ──────────────────────────

const { rows: tableRows } = await client.query(
  `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
);
const tableCount = tableRows[0].n;

const { rows: userRows } = await client.query(`SELECT to_regclass('public."User"')::text AS t`);
if (userRows[0].t === null) {
  note('fail', `[5/5] SCHEMA   ${tableCount} tables in public, but "User" is missing -> DB_SCHEMA_MISSING`);
  note('fail', 'verdict: run supabase.sql (or `prisma migrate deploy`) against THIS database.');
  process.exit(report());
}

// Compare applied migrations with the repo's — this is what catches
// "connected to the wrong database" and "the schema here is stale".
const local = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()
  .map((name) => ({
    name,
    checksum: createHash('sha256')
      .update(readFileSync(resolve(MIGRATIONS_DIR, name, 'migration.sql')))
      .digest('hex'),
  }));

let applied;
try {
  const { rows } = await client.query(
    `SELECT migration_name, checksum FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`,
  );
  applied = rows;
} catch {
  note('fail', '[5/5] SCHEMA   "_prisma_migrations" is missing — Prisma never applied a schema here');
  process.exit(report());
}

const appliedByName = new Map(applied.map((r) => [r.migration_name, r.checksum]));
const missing = local.filter((m) => !appliedByName.has(m.name));
const drifted = local.filter(
  (m) => appliedByName.has(m.name) && appliedByName.get(m.name) !== m.checksum,
);

note('ok', `[5/5] SCHEMA   ${tableCount} tables, "User" present, ${applied.length} migrations applied`);
if (missing.length) note('fail', `[5/5] SCHEMA   not applied here: ${missing.map((m) => m.name).join(', ')}`);
if (drifted.length) note('fail', `[5/5] SCHEMA   checksum drift: ${drifted.map((m) => m.name).join(', ')}`);
if (!missing.length && !drifted.length) note('ok', '[5/5] SCHEMA   migrations match the repo byte for byte');

await client.end();
process.exit(report());

// ─── verdict ────────────────────────────────────────────────────────────────

function report() {
  const failed = findings.filter((f) => f.level === 'fail');
  console.log(
    failed.length === 0
      ? '\nverdict: OK — this DATABASE_URL is usable by the application.\n'
      : `\nverdict: ${failed.length} problem(s) above.\n`,
  );
  return failed.length === 0 ? 0 : 1;
}
