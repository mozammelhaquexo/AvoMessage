// Heavier stress + the actual login endpoint.
// 100 concurrent GETs across health/landing/login/signup + 30 concurrent
// POST /api/auth/login attempts (will mostly 4xx because there's no real
// test user, but they MUST NOT 5xx — a 500 here means the DB pool failed).
const urls = [
  'https://avomessage.vercel.app/api/health',
  'https://avomessage.vercel.app/',
  'https://avomessage.vercel.app/login',
  'https://avomessage.vercel.app/signup',
];

async function hammer(url, count, opts = {}) {
  const out = { url, total: count, byCode: {}, errors: new Set() };
  await Promise.all(
    Array.from({ length: count }, async () => {
      try {
        const res = await fetch(url, opts);
        out.byCode[res.status] = (out.byCode[res.status] ?? 0) + 1;
        if (res.status >= 500) {
          const text = await res.text();
          out.errors.add(text.slice(0, 140));
        }
      } catch (e) {
        out.byCode[`NET_${e.code ?? 'OTHER'}`] = (out.byCode[`NET_${e.code ?? 'OTHER'}`] ?? 0) + 1;
      }
    }),
  );
  return out;
}

async function hammerPost(url, count, body) {
  const out = { url, total: count, byCode: {}, errors: new Set() };
  await Promise.all(
    Array.from({ length: count }, async () => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        out.byCode[res.status] = (out.byCode[res.status] ?? 0) + 1;
        if (res.status >= 500) {
          const text = await res.text();
          out.errors.add(text.slice(0, 140));
        }
      } catch (e) {
        out.byCode[`NET_${e.code ?? 'OTHER'}`] = (out.byCode[`NET_${e.code ?? 'OTHER'}`] ?? 0) + 1;
      }
    }),
  );
  return out;
}

const start = Date.now();
const results = await Promise.all([
  hammer(urls[0], 100),          // health  ×100
  hammer(urls[1], 100),          // /       ×100
  hammer(urls[2], 50),           // /login  ×50
  hammer(urls[3], 50),           // /signup ×50
  hammerPost('https://avomessage.vercel.app/api/auth/login', 30, {
    username: 'nobody@example.com',
    password: 'wrong-password-stress-test',
  }),
]);
const ms = Date.now() - start;

for (const r of results) {
  console.log(`${r.url}  ×${r.total}  ${JSON.stringify(r.byCode)}`);
  if (r.errors.size) {
    console.log('  ⚠ 500-class errors:');
    for (const e of r.errors) console.log('    ' + e);
  }
}
console.log(`\nelapsed: ${ms}ms`);
const total500 = results.reduce((n, r) => n + (r.byCode[500] ?? 0) + (r.byCode[502] ?? 0) + (r.byCode[503] ?? 0), 0);
console.log(total500 === 0 ? '✅ zero 5xx' : `❌ ${total500} 5xx responses`);