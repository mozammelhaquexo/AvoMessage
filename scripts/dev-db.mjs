/**
 * scripts/dev-db.mjs — embedded Postgres on port 5432 with .env-matching creds.
 * Stops on SIGINT/SIGTERM. Run with:  node scripts/dev-db.mjs
 */
import EmbeddedPostgres from 'embedded-postgres';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '..', '.embedded-pg');

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'avomessage',
  password: 'avomessage_dev_pw',
  port: 5432,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

console.log('[dev-db] data dir:', dataDir);
console.log('[dev-db] starting (first run may take ~10s to initdb)…');

// Only run initdb the very first time; subsequent starts reuse the existing cluster.
const alreadyInitialised = (await import('node:fs')).existsSync(path.join(dataDir, 'PG_VERSION'));
if (!alreadyInitialised) {
  await pg.initialise();
  console.log('[dev-db] initialised.');
} else {
  console.log('[dev-db] reusing existing cluster at', dataDir);
}
await pg.start();
console.log('[dev-db] listening on localhost:5432 (user=avomessage)');
// embedded-postgres creates a default DB matching the username; ensure .env target exists.
try {
  await pg.createDatabase('avomessage_dev');
  console.log('[dev-db] created database: avomessage_dev');
} catch (e) {
  const msg = String(e?.message ?? e);
  if (msg.includes('already exists')) console.log('[dev-db] avomessage_dev already exists');
  else throw e;
}

const shutdown = async (sig) => {
  console.log(`\n[dev-db] ${sig} — stopping…`);
  try { await pg.stop(); } catch (e) { console.error('[dev-db] stop error:', e); }
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Keep running
await new Promise(() => {});