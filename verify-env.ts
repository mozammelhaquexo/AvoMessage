import { spawnSync } from 'node:child_process';

const url = 'postgresql://postgres.aftgimakqnthytgfqpvh:OJKHW%26%2Adnb38df3wd@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=no-verify';

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
console.log('stdout:', proc.stdout);
console.log('stderr:', proc.stderr);