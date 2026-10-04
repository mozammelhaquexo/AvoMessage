/**
 * scripts/send-test-otp-email.ts — send one real OTP email through the
 * configured mailer, so SMTP credentials and the template can be checked
 * without creating a user or waiting on a signup.
 *
 * Run:  npx tsx scripts/send-test-otp-email.ts you@example.com [purpose]
 *
 * It loads .env itself (tsx does not), picks the driver from MAILER_DRIVER, and
 * prints the SMTP outcome. The code it sends is a fixed sample — this is a
 * delivery test, not an auth flow, and it writes no database rows.
 *
 * No top-level await: this project's tsconfig emits CJS and esbuild rejects it.
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

type Purpose = 'SIGNUP' | 'COMPANY_MEMBER' | 'COMPANY_MANAGER';

async function main(): Promise<void> {
  // .env must be loaded BEFORE lib/mailer is imported: the dynamic import is
  // deliberate, a static one would be hoisted above loadEnv().
  loadEnv();
  const { getMailer, Templates } = await import('../lib/mailer');

  const to = process.argv[2];
  if (!to) {
    console.error(
      'usage: npx tsx scripts/send-test-otp-email.ts <to@address> [SIGNUP|COMPANY_MEMBER|COMPANY_MANAGER]',
    );
    process.exit(2);
  }
  const purpose = (process.argv[3] ?? 'SIGNUP') as Purpose;

  const driver = (process.env.MAILER_DRIVER ?? 'log').toLowerCase();
  const code = '418902';

  console.log(`driver   : ${driver}`);
  console.log(`to       : ${to}`);
  console.log(`purpose  : ${purpose}`);
  if (driver === 'smtp') {
    console.log(
      `host     : ${process.env.SMTP_HOST}:${process.env.SMTP_PORT} (secure=${process.env.SMTP_SECURE})`,
    );
    console.log(`user     : ${process.env.SMTP_USER}`);
    console.log(`from     : ${process.env.SMTP_FROM}`);
  }
  console.log('sending…');

  const template = Templates.otpCode('Test User', code, purpose, {
    companyName: purpose === 'SIGNUP' ? null : 'Avocado Labs',
    expiresInMinutes: 10,
  });

  console.log(`subject  : ${template.subject}`);
  console.log(`html     : ${template.html.length} bytes`);
  console.log(`text     : ${template.text.length} bytes`);

  const started = Date.now();
  try {
    await getMailer().send({ to, ...template, tag: 'otp-test' });
    console.log(`\n✔ sent in ${Date.now() - started}ms`);
  } catch (e) {
    console.error(`\n✘ failed after ${Date.now() - started}ms`);
    console.error(e);
    process.exit(1);
  }
}

void main();
