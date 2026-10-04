/**
 * scripts/render-otp-email.ts — render the OTP email template to disk so it can
 * be looked at.
 *
 * Why this exists: the template is ~350 lines of hand-built table HTML, and
 * nothing in the test suite can tell you whether it *looks* right. The unit
 * tests assert the subject strings and the presence of the code; the live Gmail
 * runs prove it sends. Neither tells you the Avorex/AvoMessage header renders,
 * the Bengali glyphs have a font, or the dashed code box survived.
 *
 * So: this writes the three purposes out as standalone HTML, plus an
 * `index.html` gallery that shows all three at once next to the subject line
 * and the plain-text part — the two things a rendered preview cannot show you
 * and the two things that break silently.
 *
 * Run:  npx tsx scripts/render-otp-email.ts
 * Then open: storage/mail-preview/index.html
 *
 * Output goes to storage/mail-preview/, deliberately NOT storage/mail/ — that
 * directory is the log mailer's outbox, and mixing generated previews into it
 * would make the sent-mail history untrustworthy.
 *
 * No top-level await: this project's tsconfig emits CJS and esbuild rejects it.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { otpEmail, type OtpEmailInput } from '../lib/mail/otp-template';

const OUT_DIR = join(process.cwd(), 'storage', 'mail-preview');

/**
 * One sample per purpose. Codes are plausible but not real, and the names are
 * deliberately mixed-script-adjacent so a Bengali-font regression is visible in
 * the greeting as well as the body.
 */
const SAMPLES: Array<{ slug: string; label: string; input: OtpEmailInput }> = [
  {
    slug: 'otp-signup',
    label: 'Flow A — signup',
    input: { name: 'Mozammel Haque', code: '418902', purpose: 'SIGNUP', expiresInMinutes: 10 },
  },
  {
    slug: 'otp-companymember',
    label: 'Flow B — manager adds a member',
    input: {
      name: 'Nusrat Jahan',
      code: '573104',
      purpose: 'COMPANY_MEMBER',
      expiresInMinutes: 10,
      companyName: 'Avocado Labs',
    },
  },
  {
    slug: 'otp-companymanager',
    label: 'Flow C — admin adds a manager',
    input: {
      name: 'Tanvir Ahmed',
      code: '908233',
      purpose: 'COMPANY_MANAGER',
      expiresInMinutes: 10,
      companyName: 'Avocado Labs',
    },
  },
];

/**
 * `srcdoc` is an attribute value, so the whole document has to survive being
 * quoted. Ampersand first, or the later replacements get double-escaped.
 */
function attr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function gallery(rendered: Array<{ slug: string; label: string; subject: string; html: string; text: string }>): string {
  const cards = rendered
    .map(
      (r) => `
    <section class="card">
      <header>
        <h2>${esc(r.label)}</h2>
        <p class="subject"><span>Subject</span> <code>${esc(r.subject)}</code></p>
        <p class="meta">html ${r.html.length.toLocaleString('en-US')} B &middot; text ${r.text.length.toLocaleString('en-US')} B &middot; <a href="${r.slug}.html">open on its own</a></p>
      </header>
      <div class="frame">
        <iframe title="${esc(r.label)}" srcdoc="${attr(r.html)}" loading="lazy"></iframe>
      </div>
      <details>
        <summary>plain-text part</summary>
        <pre>${esc(r.text)}</pre>
      </details>
    </section>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AvoMessage — OTP email preview</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 20px 60px;
    background: #0b1120; color: #e2e8f0;
    font: 15px/1.6 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 6px; color: #ecfccb; }
  .intro { margin: 0 0 28px; color: #94a3b8; font-size: 13px; }
  .intro code { color: #bef264; }
  .card {
    background: #111c33; border: 1px solid #1e293b; border-radius: 14px;
    padding: 18px; margin-bottom: 26px;
  }
  .card h2 { font-size: 15px; margin: 0 0 10px; color: #fff; }
  .subject { margin: 0 0 4px; font-size: 13px; color: #cbd5e1; }
  .subject span {
    display: inline-block; min-width: 62px; color: #64748b;
    font-size: 11px; letter-spacing: 1px; text-transform: uppercase;
  }
  .subject code { color: #bef264; font-size: 13px; }
  .meta { margin: 0 0 14px; font-size: 12px; color: #64748b; }
  .meta a { color: #5eead4; }
  /* The email is 600px wide by design; the iframe gets a little more so the
     outer shadow/border is not clipped. The frame colour matches the email's
     own canvas per scheme, so any sliver showing past the content blends
     instead of reading as a rendering fault. */
  .frame {
    background: #f1f5f9; border-radius: 10px; overflow: hidden;
    border: 1px solid #334155;
  }
  @media (prefers-color-scheme: dark) { .frame { background: #0b1120; } }
  .frame iframe { display: block; width: 100%; height: 900px; border: 0; }
  details { margin-top: 12px; }
  summary { cursor: pointer; font-size: 12px; color: #94a3b8; }
  pre {
    white-space: pre-wrap; word-break: break-word;
    background: #0b1120; border: 1px solid #1e293b; border-radius: 8px;
    padding: 12px; margin: 10px 0 0; font-size: 12px; color: #cbd5e1;
  }
</style>
</head>
<body>
  <div class="wrap">
    <h1>AvoMessage — OTP email preview</h1>
    <p class="intro">
      Rendered from <code>lib/mail/otp-template.ts</code> on ${new Date().toISOString()}.
      Sample codes, not real ones. The rendered body is the template as it ships;
      the plain-text part underneath each one is what a text-only client shows.
    </p>
${cards}
  </div>
</body>
</html>`;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const rendered = SAMPLES.map((s) => {
    const out = otpEmail(s.input);
    return { slug: s.slug, label: s.label, ...out };
  });

  for (const r of rendered) {
    await writeFile(join(OUT_DIR, `${r.slug}.html`), r.html, 'utf8');
    console.log(`${r.slug}.html  ${r.html.length} B html / ${r.text.length} B text`);
    console.log(`  subject: ${r.subject}`);
  }

  await writeFile(join(OUT_DIR, 'index.html'), gallery(rendered), 'utf8');
  console.log(`\nindex.html -> ${join('storage', 'mail-preview', 'index.html')}`);
}

void main();
