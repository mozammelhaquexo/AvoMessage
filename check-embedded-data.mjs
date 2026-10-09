// Check what's in the local embedded Postgres (may have user data from local dev)
import pg from 'pg';
import path from 'node:path';
import { existsSync } from 'node:fs';

const candidates = ['F:/AVOREX TECHNOLOGIES/AvoMessage/AvoMessage/.embedded-pg'];
for (const dir of candidates) {
  if (!existsSync(path.join(dir, 'PG_VERSION'))) {
    console.log(dir, '— not a Postgres data dir, skipping');
    continue;
  }
  console.log(dir, '— looks like a Postgres cluster, listing top-level:');
  console.log('  PG_VERSION:', existsSync(path.join(dir, 'PG_VERSION')) ? 'yes' : 'no');
}

console.log('\n--- Memory files (looking for any data snapshots/seed dumps) ---');