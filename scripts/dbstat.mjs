import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const p = join(process.cwd(), '.env');
if (existsSync(p)) {
  for (const l of readFileSync(p, 'utf8').split('\n')) {
    const t = l.trim();
    if (!t || t.startsWith('#')) continue;
    const e = t.indexOf('=');
    if (e <= 0) continue;
    const k = t.slice(0, e).trim();
    let v = t.slice(e + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

const { prisma } = await import('../lib/db');

const users = await prisma.user.findMany({
  select: { email: true, platformRole: true, createdAt: true },
  orderBy: { createdAt: 'asc' },
});
console.log('users:', users.length);
for (const u of users) {
  const email = u.email.padEnd(44);
  const role = u.platformRole.padEnd(12);
  console.log('  ' + email + ' ' + role + ' ' + u.createdAt.toISOString().slice(0, 16));
}
const nonDemo = users.filter((u) => !u.email.endsWith('@avomessage.demo'));
console.log('non-demo users:', nonDemo.length);
console.log('companies:', await prisma.company.count());
console.log('posts:', await prisma.post.count());
console.log('messages:', await prisma.message.count());
console.log('conversations:', await prisma.conversation.count());
console.log('comments:', await prisma.comment.count());
console.log('managerApplications:', await prisma.managerApplication.count());
console.log('systemSettings:', await prisma.systemSetting.count());
await prisma.$disconnect();
