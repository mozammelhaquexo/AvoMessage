/**
 * generate-app-icons.mjs — raster app icons for notifications and PWA install.
 *
 * WHY THIS IS A SCRIPT AND NOT FOUR COMMITTED BINARIES NOBODY CAN EDIT
 * `showNotification({ icon })` needs a real raster image — SVG is not accepted
 * for a notification icon — and a web manifest needs at least 192px and 512px
 * PNGs before a browser will treat the site as installable (which is also what
 * `setAppBadge` requires). The repo shipped none of them, so every notification
 * would have rendered with a blank icon.
 *
 * The mark is drawn geometrically rather than loaded from a font, and the PNG
 * is encoded with `node:zlib` — no image library, no Python, no network. That
 * keeps it reproducible with the runtime the project already has.
 *
 * Usage:  node scripts/generate-app-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

// Brand tokens, copied from app/globals.css (--brand / --accent).
const BRAND = [0x65, 0xa3, 0x0d]; // lime-600
const ACCENT = [0x0d, 0x94, 0x88]; // teal-600
const INK = [0xf7, 0xfe, 0xe7]; // near-white lime tint, for the glyph

/* ------------------------------------------------------------------ */
/* PNG encoding                                                        */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Encode an RGBA pixel buffer (size × size × 4) as a PNG. */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 = compression / filter / interlace, all 0.

  // One filter byte (0 = None) per scanline, then the row.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* The mark                                                            */
/* ------------------------------------------------------------------ */

/** Signed area test: is (px, py) inside the triangle a, b, c? */
function inTriangle(px, py, a, b, c) {
  const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = sign([px, py], a, b);
  const d2 = sign([px, py], b, c);
  const d3 = sign([px, py], c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Render the icon at `size` px.
 *
 * `bleed` scales the mark down inside the tile; the maskable variant needs a
 * generous safe area because Android crops maskable icons to a circle.
 */
function render(size, { bleed = 1 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const s = (v) => (v / 512) * size; // author coordinates at 512 and scale

  // Geometry, in 512-space, then scaled.
  const apex = [s(256 * bleed + 256 * (1 - bleed)), s(96 * bleed + 256 * (1 - bleed))];
  const left = [s(118 * bleed + 256 * (1 - bleed)), s(416 * bleed + 256 * (1 - bleed))];
  const right = [s(394 * bleed + 256 * (1 - bleed)), s(416 * bleed + 256 * (1 - bleed))];
  const iApex = [apex[0], s(196 * bleed + 256 * (1 - bleed))];
  const iLeft = [s(186 * bleed + 256 * (1 - bleed)), s(360 * bleed + 256 * (1 - bleed))];
  const iRight = [s(326 * bleed + 256 * (1 - bleed)), s(360 * bleed + 256 * (1 - bleed))];
  const barTop = s(308 * bleed + 256 * (1 - bleed));
  const barBottom = s(346 * bleed + 256 * (1 - bleed));

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;

      // Rounded-square alpha: outside the corner arcs is fully transparent.
      const cx = Math.min(Math.max(px, radius), size - radius);
      const cy = Math.min(Math.max(py, radius), size - radius);
      const dist = Math.hypot(px - cx, py - cy);
      if (dist > radius) continue;
      // Feather the last pixel of the edge so it is not jagged.
      const edge = Math.max(0, Math.min(1, radius - dist));

      // Diagonal gradient, top-left lime → bottom-right teal.
      const t = Math.max(0, Math.min(1, (px / size) * 0.55 + (py / size) * 0.45));
      let r = Math.round(BRAND[0] + (ACCENT[0] - BRAND[0]) * t);
      let g = Math.round(BRAND[1] + (ACCENT[1] - BRAND[1]) * t);
      let b = Math.round(BRAND[2] + (ACCENT[2] - BRAND[2]) * t);

      // The "A": outer triangle minus the inner triangle, plus a crossbar.
      const insideOuter = inTriangle(px, py, apex, left, right);
      if (insideOuter) {
        const insideInner = inTriangle(px, py, iApex, iLeft, iRight);
        const inBar = py >= barTop && py <= barBottom;
        if (!insideInner || inBar) {
          r = INK[0];
          g = INK[1];
          b = INK[2];
        }
      }

      const offset = (y * size + x) * 4;
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = Math.round(edge * 255);
    }
  }

  return encodePng(size, rgba);
}

const targets = [
  ['public/icon-192.png', 192, {}],
  ['public/icon-512.png', 512, {}],
  ['public/apple-touch-icon.png', 180, {}],
  // Maskable icons get cropped to a circle on Android, so the mark is inset.
  ['public/icon-maskable-512.png', 512, { bleed: 0.72 }],
];

for (const [path, size, opts] of targets) {
  writeFileSync(path, render(size, opts));
  console.log(`wrote ${path} (${size}x${size})`);
}
