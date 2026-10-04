import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname");
console.log('Databases:', r.rows.map(x => x.datname).join(', '));
const me = await c.query('SELECT current_user, current_database()');
console.log('Connection: user=' + me.rows[0].current_user + ' db=' + me.rows[0].current_database);
await c.end();