// Voice upload E2E test using fetch (Node 22+)
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:3000';

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'demo@avomessage.demo', password: 'Demo1234!' }),
  });
  if (!r.ok) throw new Error(`Login ${r.status}`);
  // Capture cookies
  const setCookie = r.headers.getSetCookie?.() ?? r.headers.get('set-cookie')?.split(',') ?? [];
  const cookieHeader = setCookie.map(c => c.split(';')[0]).join('; ');
  const csrf = setCookie.find(c => c.startsWith('avo_csrf='))?.split(';')[0].split('=')[1];
  console.log('Login OK, csrf:', csrf.slice(0, 12) + '...');
  return { cookieHeader, csrf };
}

async function upload({ cookieHeader, csrf, mimeType, fileBytes, filename }) {
  const form = new FormData();
  // Build a Blob with a specific MIME; this is what the browser would send.
  const blob = new Blob([new Uint8Array(fileBytes)], { type: mimeType });
  form.append('file', blob, filename);
  form.append('kind', 'voice');
  const r = await fetch(`${BASE}/api/uploads`, {
    method: 'POST',
    headers: {
      cookie: cookieHeader,
      'x-csrf-token': csrf,
    },
    body: form,
  });
  const text = await r.text();
  return { status: r.status, body: text };
}

const { cookieHeader, csrf } = await login();

// Minimal EBML header for the sniff check
const webmBytes = Buffer.from([
  0x1A, 0x45, 0xDF, 0xA3, 0xA3, 0x42, 0x86, 0x81, 0x01,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1F, 0x43,
  0xB6, 0x75, 0x4D, 0x80, 0x84, 0x00, 0x00,
]);

console.log('\n=== Test 1: audio/webm (no codec) ===');
const r1 = await upload({ cookieHeader, csrf, mimeType: 'audio/webm', fileBytes: webmBytes, filename: 'voice-test-1.webm' });
console.log(`Status: ${r1.status}`);
console.log(`Body: ${r1.body.slice(0, 200)}`);

console.log('\n=== Test 2: audio/webm;codecs=opus (the original bug) ===');
const r2 = await upload({ cookieHeader, csrf, mimeType: 'audio/webm;codecs=opus', fileBytes: webmBytes, filename: 'voice-test-2.webm' });
console.log(`Status: ${r2.status}`);
console.log(`Body: ${r2.body.slice(0, 200)}`);