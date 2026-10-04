/**
 * apply-schema.mjs — make the database that DATABASE_URL names usable by the app.
 *
 * WHY THIS EXISTS. Vercel builds this project as Next.js, so `server.ts` never
 * runs there and nothing ever applied the migrations: the deployed app held a
 * working connection to a database with zero tables, answered every query with
 * `42P01 relation "public.User" does not exist`, and returned
 * `500 INTERNAL_ERROR` for every write. The health endpoint reported `ok`
 * because it only ran `SELECT 1`.
 *
 * The fix is to apply the schema where the credentials already are — inside the
 * deployment itself. Vercel runs the `vercel-build` script (package.json) with
 * the project's environment, so this runs with the real DATABASE_URL and needs
 * no credential to be copied anywhere by hand.
 *
 * IDEMPOTENT BY CONSTRUCTION. It executes the root `supabase.sql`, whose every
 * statement is guarded (`CREATE TABLE IF NOT EXISTS`, DO-blocks checked against
 * the catalog), so running on every build is a no-op once the schema exists.
 * `supabase.sql` is generated from `prisma/migrations` and verified against a
 * scratch database by `npm run supabase:verify`.
 *
 * It also creates the platform administrator, but only if that account is
 * missing — an existing account's password is never overwritten, so a build can
 * never lock the operator out of their own account.
 *
 * Usage:
 *   npm run vercel-build                     # production builds (guarded)
 *   node scripts/apply-schema.mjs            # run explicitly, any environment
 *   APPLY_SCHEMA=1 node scripts/apply-schema.mjs
 *
 * Exit codes: 0 success or nothing to do; 1 a real failure, so the build stops
 * rather than deploying an app whose database is unusable.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);

const ADMIN_EMAIL = 'mozammelhaquexo@gmail.com';
const ADMIN_USERNAME = 'mozammelhaquexo';
const ADMIN_NAME = 'Mozammel Haque';

function log(msg) {
  console.log(`[apply-schema] ${msg}`);
}

// ─── which database? ────────────────────────────────────────────────────────

/**
 * Vercel Postgres / Neon installs several aliases for the same database. The
 * app reads DATABASE_URL, so that wins; the others are fallbacks for the case
 * where the alias exists but DATABASE_URL was not carried over.
 */
const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.PRISMA_DATABASE_URL ||
  '';

const sourceVar = process.env.DATABASE_URL
  ? 'DATABASE_URL'
  : process.env.POSTGRES_URL
    ? 'POSTGRES_URL'
    : process.env.PRISMA_DATABASE_URL
      ? 'PRISMA_DATABASE_URL'
      : null;

if (!connectionString) {
  log('no database URL in the environment (DATABASE_URL / POSTGRES_URL / PRISMA_DATABASE_URL) — nothing to do');
  process.exit(0);
}

/**
 * Preview deployments share the same database variables, so letting every
 * preview build migrate would mean a branch push can change production's
 * schema. Only production applies it, unless explicitly forced.
 */
if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production' && process.env.APPLY_SCHEMA !== '1') {
  log(`VERCEL_ENV=${process.env.VERCEL_ENV} — not production, skipping (set APPLY_SCHEMA=1 to force)`);
  process.exit(0);
}

/** Redacted form, safe to log. */
const safeTarget = (() => {
  try {
    const u = new URL(connectionString);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return '(unparseable URL)';
  }
})();

log(`target ${safeTarget} (from ${sourceVar})`);

// ─── 1. apply supabase.sql ──────────────────────────────────────────────────

const SQL_FILE = 'supabase.sql';
if (!existsSync(SQL_FILE)) {
  log(`ERROR: ${SQL_FILE} is missing. Run \`npm run supabase:sql\` to generate it.`);
  process.exit(1);
}

const sql = readFileSync(SQL_FILE, 'utf8');

const client = new pg.Client({ connectionString, connectionTimeoutMillis: 30000 });

try {
  await client.connect();
} catch (err) {
  // The connection error is the whole diagnosis, so print it rather than a
  // generic failure. `npm run db:check "<url>"` breaks it down layer by layer.
  log(`ERROR: cannot connect — ${err.code ?? '?'}: ${String(err.message).split('\n')[0]}`);
  process.exit(1);
}

try {
  // One multi-statement simple query, so the whole file applies atomically: a
  // failure rolls everything back instead of leaving a half-built schema.
  await client.query(sql);
  log(`applied ${SQL_FILE} (${sql.length} bytes)`);

  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const tableCount = rows[0].n;
  log(`public schema now has ${tableCount} tables`);
  if (tableCount === 0) {
    log('ERROR: the schema applied but the database still reports no tables');
    process.exit(1);
  }
} catch (err) {
  log(`ERROR: applying ${SQL_FILE} failed — ${err.code ?? '?'}: ${String(err.message).split('\n')[0]}`);
  if (err.position) log(`       at character offset ${err.position}`);
  await client.end().catch(() => {});
  process.exit(1);
}

// ─── 2. the platform administrator ──────────────────────────────────────────

const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;

if (!adminPassword) {
  log('ADMIN_BOOTSTRAP_PASSWORD is not set — leaving accounts untouched');
} else {
  // Prisma Client, not raw SQL, so cuid ids, `@updatedAt` and enum casts are
  // handled by the same code the application uses.
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const bcrypt = require('bcryptjs');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const rounds = Number.parseInt(process.env.BCRYPT_ROUNDS ?? '', 10);
    // Mirrors lib/auth/password.ts exactly: bcryptjs, cost 12 unless overridden.
    const cost = Number.isFinite(rounds) && rounds >= 10 ? rounds : 12;

    const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });

    if (existing) {
      // Re-assert the flags that gate sign-in, but never the password: a build
      // must not be able to reset credentials the operator has since changed.
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          platformRole: 'SUPER_ADMIN',
          isActive: true,
          isVerified: true,
          deletedAt: null,
          emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
        },
      });
      log(`administrator ${ADMIN_EMAIL} already exists (id ${existing.id}) — flags re-asserted, password left alone`);
    } else {
      const passwordHash = await bcrypt.hash(adminPassword, cost);
      const created = await prisma.user.create({
        data: {
          email: ADMIN_EMAIL,
          username: ADMIN_USERNAME,
          name: ADMIN_NAME,
          passwordHash,
          platformRole: 'SUPER_ADMIN',
          isVerified: true,
          isActive: true,
          emailVerifiedAt: new Date(),
        },
      });
      log(`administrator created: ${created.email} (id ${created.id}), role ${created.platformRole}, bcrypt cost ${cost}`);
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

await client.end().catch(() => {});
log('done');
