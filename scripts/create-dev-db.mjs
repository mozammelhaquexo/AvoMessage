import { Client } from 'pg';
const url = process.env.DATABASE_URL ?? 'postgresql://avomessage:avomessage_dev_pw@localhost:5432/postgres';
const c = new Client({ connectionString: url });
await c.connect();
const r = await c.query("SELECT 1 FROM pg_database WHERE datname = 'avomessage_dev'");
if (r.rowCount === 0) {
  await c.query('CREATE DATABASE avomessage_dev');
  console.log('Created avomessage_dev');
} else {
  console.log('avomessage_dev already exists');
}
await c.end();