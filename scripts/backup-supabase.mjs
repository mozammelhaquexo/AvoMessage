#!/usr/bin/env node
/**
 * scripts/backup-supabase.mjs — manual snapshot of the live database.
 *
 * Writes a gzipped pg_dump to `backups/<timestamp>.sql.gz` (gitignored).
 * Run before any risky operation, after a successful deploy, or any time you
 * want a point-in-time snapshot you can restore from with `pg_restore`.
 *
 *   node scripts/backup-supabase.mjs                       # snapshot to ./backups/
 *   node scripts/backup-supabase.mjs --label pre-migration # custom filename
 *   node scripts/backup-supabase.mjs --stdout              # dump to stdout (pipe to S3, etc.)
 *   node scripts/backup-supabase.mjs --schema-only         # no data, schema only
 *
 * The script uses the TRANSACTION-mode URL (port 6543) — it is the only one
 * that works on Supabase Free under serverless burst traffic, and the only one
 * that supports running `pg_dump` cleanly.
 *
 * Requires the `pg_dump` binary on PATH. On Windows you can install PostgreSQL
 * client tools, or use `pg_dump` from any Linux/macOS terminal.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import path from 'node:path';

const args = process.argv.slice(2);
const toStdout = args.includes('--stdout');
const schemaOnly = args.includes('--schema-only');
const labelIdx = args.indexOf('--label');
const label = labelIdx > -1 ? args[labelIdx + 1] : null;

// Use the transaction-mode URL if available, else fall back to whatever is in
// DATABASE_URL. The transaction pooler is the right choice for both writes and
// reads; session mode would block on Supavisor's 15-connection cap.
function pickUrl() {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.PRISMA_DATABASE_URL,
  ].filter(Boolean);
  if (candidates.length === 0) {
    console.error(
      'no DATABASE_URL / POSTGRES_URL / PRISMA_DATABASE_URL in the environment',
    );
    process.exit(2);
  }
  // Prefer port 6543 (transaction mode) over 5432 (session mode).
  const tx = candidates.find((u) => u.includes(':6543/'));
  return tx ?? candidates[0];
}

const url = pickUrl();

// Mask the password before logging it.
const safe = url.replace(/:\/\/([^:@]+):([^@]+)@/, '://$1:<pw>@');
console.log(`[backup] target ${safe}`);

// `pg_dump` flags:
//   --no-owner / --no-privileges  : the role we'll restore into may not exist yet
//   --format=plain                : plain SQL is the easiest to grep / restore selectively
//   --schema-only                 : when the caller only wants DDL
const dumpArgs = ['--no-owner', '--no-privileges', '--format=plain'];
if (schemaOnly) dumpArgs.push('--schema-only');

// `pg_dump` does NOT understand `sslmode=no-verify`. Translate to libpq-style
// env vars so the TLS connection goes through without a cert check.
const env = { ...process.env, PGSSLMODE: 'no-verify' };

const outDir = path.join(process.cwd(), 'backups');
const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const filename = `avomessage-${label ?? ts}.sql`;
const outFile = path.join(outDir, `${filename}.gz`);

if (!toStdout) mkdirSync(outDir, { recursive: true });

console.log(`[backup] writing ${toStdout ? '<stdout>' : outFile}`);

const child = spawn('pg_dump', [...dumpArgs, url], { env });

if (toStdout) {
  child.stdout.pipe(createGzip()).pipe(process.stdout);
} else {
  child.stdout.pipe(createGzip()).pipe(createWriteStream(outFile));
}

let stderrBuf = '';
child.stderr.on('data', (chunk) => {
  stderrBuf += chunk.toString();
});

child.on('close', (code) => {
  if (code !== 0) {
    console.error(`[backup] pg_dump exited ${code}`);
    console.error(stderrBuf);
    process.exit(code ?? 1);
  }
  if (!toStdout) {
    console.log(`[backup] done — ${outFile}`);
    console.log(
      `[backup] restore with:  gunzip -c "${path.relative(process.cwd(), outFile)}" | psql "$DATABASE_URL"`,
    );
  }
});

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error(
      '[backup] pg_dump not found on PATH. Install PostgreSQL client tools ' +
        '(https://www.postgresql.org/download/) and re-run.',
    );
    process.exit(127);
  }
  throw err;
});