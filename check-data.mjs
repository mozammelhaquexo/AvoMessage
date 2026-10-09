// Quick row counts on Supabase to see if any data survived.
import pg from 'pg';

const url = 'postgresql://postgres.aftgimakqnthytgfqpvh:OJKHW%26%2Adnb38df3wd@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=no-verify&pgbouncer=true';
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const tables = ['User', 'Session', 'Message', 'Conversation', 'Company', 'CompanyMember', 'Post', 'Reaction', 'Notification', 'Attachment', 'Follow', 'OtpChallenge', 'PasswordReset'];

for (const t of tables) {
  try {
    const r = await c.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    console.log(t.padEnd(20), r.rows[0].n);
  } catch (e) {
    console.log(t.padEnd(20), 'ERR', e.message.split('\n')[0]);
  }
}

await c.end();