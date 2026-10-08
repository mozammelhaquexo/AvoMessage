import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const url = readFileSync('.tmp-supabase-tx-url.txt', 'utf8').trim();

const proc = spawnSync(
  'npx.cmd',
  ['vercel', 'env', 'add', 'DATABASE_URL', 'production'],
  {
    cwd: 'F:/AVOREX TECHNOLOGIES/AvoMessage/AvoMessage',
    input: url,
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: true,
  },
);

console.log('exit:', proc.status);