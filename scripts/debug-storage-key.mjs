// Reproduce the FIXED resolveKey logic
import { normalize, join, resolve, sep } from 'node:path';

function localBaseDir() {
  const raw = process.env.STORAGE_LOCAL_DIR ?? join(process.cwd(), 'storage', 'uploads');
  return resolve(raw);
}

class LocalStorageDriver {
  constructor(baseDir = localBaseDir()) { this.baseDir = baseDir; }
  resolveKey(key) {
    const normalized = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    const full = resolve(this.baseDir, normalized);
    const baseWithSep = this.baseDir.endsWith(sep) ? this.baseDir : this.baseDir + sep;
    if (full !== this.baseDir && !full.toLowerCase().startsWith(baseWithSep.toLowerCase())) {
      throw new Error('Invalid storage key (path traversal)');
    }
    return full;
  }
}

console.log('=== TEST 1: relative baseDir (./storage/uploads) ===');
process.env.STORAGE_LOCAL_DIR = './storage/uploads';
const d1 = new LocalStorageDriver();
console.log('baseDir:', d1.baseDir);
try {
  const full = d1.resolveKey('voice/2026/10/test.webm');
  console.log('PASS: valid key →', full);
} catch (e) { console.log('FAIL:', e.message); }
try {
  d1.resolveKey('voice/../etc/passwd');
  console.log('FAIL: traversal allowed!');
} catch (e) { console.log('PASS: traversal rejected:', e.message); }

console.log('=== TEST 2: absolute baseDir ===');
process.env.STORAGE_LOCAL_DIR = 'C:\\temp\\storage';
const d2 = new LocalStorageDriver();
console.log('baseDir:', d2.baseDir);
try {
  const full = d2.resolveKey('voice/2026/10/test.webm');
  console.log('PASS: valid key →', full);
} catch (e) { console.log('FAIL:', e.message); }
try {
  d2.resolveKey('voice/../etc/passwd');
  console.log('FAIL: traversal allowed!');
} catch (e) { console.log('PASS: traversal rejected:', e.message); }

console.log('=== TEST 3: Windows-quoted baseDir ("./storage/uploads") ===');
process.env.STORAGE_LOCAL_DIR = '"./storage/uploads"';
const d3 = new LocalStorageDriver();
console.log('baseDir:', d3.baseDir);
try {
  const full = d3.resolveKey('voice/2026/10/test.webm');
  console.log('PASS: valid key →', full);
} catch (e) { console.log('FAIL:', e.message); }