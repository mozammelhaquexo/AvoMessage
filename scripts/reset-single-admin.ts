/**
 * scripts/reset-single-admin.ts — wipe every account and hand the platform to
 * exactly one administrator.
 *
 * What it does, in order:
 *   1. prints how many rows it is about to remove, per table, so the run is
 *      auditable after the fact;
 *   2. TRUNCATEs every table in the public schema EXCEPT `_prisma_migrations`
 *      (wiping it would lose the migration history) and `SystemSetting`
 *      (platform configuration, not an account — and it has no foreign keys,
 *      so nothing cascades into it);
 *   3. creates the one administrator: SUPER_ADMIN, email already verified (an
 *      unverified account cannot log in), bcrypt cost 12 like every other
 *      password in the product;
 *   4. re-reads the row from the database and checks the password against the
 *      stored hash, so the claim "this password logs this account in" is
 *      verified against what is actually on disk rather than assumed.
 *
 * Credentials come from argv, never from the file — a plaintext password must
 * not sit in the repository.
 *
 *   npx tsx scripts/reset-single-admin.ts <email> <password>
 *
 * NOTE ON THE SEED: `npx prisma db seed` recreates four demo users, one of them
 * a second SUPER_ADMIN. Running it after this script would break the one-admin
 * rule the platform enforces. Do not run it on a database meant to have exactly
 * one administrator.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function loadEnv(): void {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const [emailArg, passwordArg] = process.argv.slice(2);
const EMAIL = (emailArg ?? '').trim().toLowerCase();
const PASSWORD = passwordArg ?? '';
const USERNAME = EMAIL.split('@')[0]?.replace(/[^a-z0-9_]/g, '') || 'admin';
const NAME = 'Mozammel Haque';

if (!EMAIL || !EMAIL.includes('@')) {
  console.error('usage: npx tsx scripts/reset-single-admin.ts <email> <password>');
  process.exit(1);
}
if (PASSWORD.length < 8) {
  console.error('refusing to continue: the password is shorter than 8 characters');
  process.exit(1);
}

/** Tables that must survive the wipe. */
const PRESERVE = new Set(['_prisma_migrations', 'SystemSetting']);

async function main(): Promise<void> {
  const { prisma } = await import('../lib/db');

  // ── 1. what is here now ───────────────────────────────────────────────────
  const tables = (
    await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `
  ).map((r) => r.tablename);

  const toWipe = tables.filter((t) => !PRESERVE.has(t));
  const counts: Array<[string, number]> = [];
  for (const t of toWipe) {
    // Identifiers cannot be bound as parameters in SQL, so this has to be a
    // string-built statement — hence the explicit quoting, and hence
    // `$queryRawUnsafe` rather than the tagged form.
    const rows = await prisma
      .$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM public."${t.replace(/"/g, '""')}"`,
      )
      .catch(() => [{ n: BigInt(-1) }]);
    counts.push([t, Number(rows[0]?.n ?? -1)]);
  }

  const nonEmpty = counts.filter(([, n]) => n > 0);
  console.log('\nAbout to remove:');
  if (nonEmpty.length === 0) {
    console.log('  (nothing — every table is already empty)');
  } else {
    const width = Math.max(...nonEmpty.map(([t]) => t.length));
    for (const [t, n] of nonEmpty) console.log(`  ${t.padEnd(width)}  ${n}`);
  }
  const preserved = tables.filter((t) => PRESERVE.has(t));
  console.log(`preserved: ${preserved.join(', ')}`);

  // ── 2. the wipe ───────────────────────────────────────────────────────────
  // One statement per table, in a transaction: either the whole platform is
  // reset or none of it is. `CASCADE` pulls in anything with a foreign key
  // pointing at a table being truncated, so the order does not have to be
  // derived from the schema.
  await prisma.$transaction(async (tx) => {
    for (const t of toWipe) {
      await tx.$executeRawUnsafe(`TRUNCATE TABLE public."${t.replace(/"/g, '""')}" CASCADE`);
    }
  });
  console.log(`\ntruncated ${toWipe.length} tables.`);

  // ── 3. the one administrator ──────────────────────────────────────────────
  const { hashPassword, verifyPassword } = await import('../lib/auth/password');
  const passwordHash = await hashPassword(PASSWORD);

  const admin = await prisma.user.create({
    data: {
      email: EMAIL,
      emailVerifiedAt: new Date(), // an unverified account cannot log in
      passwordHash,
      name: NAME,
      username: USERNAME,
      platformRole: 'SUPER_ADMIN',
      isVerified: true,
      presence: { create: { status: 'OFFLINE' } },
    },
  });

  // ── 4. verify against what is actually stored ─────────────────────────────
  const reread = await prisma.user.findUnique({ where: { id: admin.id } });
  if (!reread) throw new Error('the administrator row vanished immediately after creation');

  const total = await prisma.user.count();
  const admins = await prisma.user.count({
    where: { platformRole: { in: ['ADMIN', 'SUPER_ADMIN'] }, deletedAt: null },
  });
  const passwordOk = await verifyPassword(PASSWORD, reread.passwordHash);

  console.log('\nAdministrator:');
  console.log(`  id          ${reread.id}`);
  console.log(`  email       ${reread.email}`);
  console.log(`  username    ${reread.username}`);
  console.log(`  platformRole ${reread.platformRole}`);
  console.log(`  emailVerified ${reread.emailVerifiedAt !== null}`);
  console.log(`  password verifies against the stored hash: ${passwordOk ? 'yes' : 'NO'}`);
  console.log('\nPlatform state:');
  console.log(`  users                     ${total}`);
  console.log(`  administrators            ${admins}`);
  console.log(`  companies                 ${await prisma.company.count()}`);
  console.log(`  manager applications      ${await prisma.managerApplication.count()}`);
  console.log(`  sessions                  ${await prisma.session.count()}`);

  const problems: string[] = [];
  if (total !== 1) problems.push(`expected exactly 1 user, found ${total}`);
  if (admins !== 1) problems.push(`expected exactly 1 administrator, found ${admins}`);
  if (reread.platformRole !== 'SUPER_ADMIN') {
    problems.push(`platformRole is ${reread.platformRole}, expected SUPER_ADMIN`);
  }
  if (reread.emailVerifiedAt === null) problems.push('the account is not email-verified and cannot log in');
  if (!passwordOk) problems.push('the password does NOT verify against the stored hash');

  if (problems.length > 0) {
    console.error('\nFAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('\nOK — one administrator, verified.');
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('\nreset crashed:', err);
  process.exit(1);
});
