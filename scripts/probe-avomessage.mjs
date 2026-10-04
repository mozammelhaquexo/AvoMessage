import { Client } from 'pg';
const url = 'postgresql://avomessage:avomessage_dev_pw@localhost:5432/avomessage_dev';
const c = new Client({ connectionString: url });
try {
  await c.connect();
  const r = await c.query('SELECT current_database(), current_user, version()');
  console.log('OK:', JSON.stringify(r.rows[0]));
  const t = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  console.log('Tables:', t.rows.map(x => x.table_name).join(', ') || '(none)');
} catch (e) {
  console.error('FAILED:', e.message, e.code);
}
await c.end();