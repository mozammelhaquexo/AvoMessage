// Stress-test the deployed API: 50 concurrent requests against health + landing page.
// Confirms the Supabase transaction-mode pooler absorbs burst traffic without
// hitting EMAXCONNSESSION.
const urls = [
  'https://avomessage.vercel.app/api/health',
  'https://avomessage.vercel.app/',
  'https://avomessage.vercel.app/login',
  'https://avomessage.vercel.app/signup',
];

async function hammer(url, count) {
  const out = { url, total: count, byCode: {}, errors: new Set() };
  await Promise.all(
    Array.from({ length: count }, async () => {
      try {
        const res = await fetch(url);
        out.byCode[res.status] = (out.byCode[res.status] ?? 0) + 1;
        if (res.status >= 500) {
          const text = await res.text();
          out.errors.add(text.slice(0, 120));
        }
      } catch (e) {
        out.byCode[`NET_${e.code ?? 'OTHER'}`] = (out.byCode[`NET_${e.code ?? 'OTHER'}`] ?? 0) + 1;
      }
    }),
  );
  return out;
}

const total = 20;
const start = Date.now();
const results = await Promise.all(urls.map((u) => hammer(u, total)));
const ms = Date.now() - start;

for (const r of results) {
  console.log(`${r.url}  ×${r.total}  ${JSON.stringify(r.byCode)}`);
  if (r.errors.size) {
    console.log('  errors:');
    for (const e of r.errors) console.log('    ' + e);
  }
}
console.log(`\nelapsed: ${ms}ms`);