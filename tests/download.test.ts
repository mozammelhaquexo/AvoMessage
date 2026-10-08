/**
 * tests/download.test.ts — building a link that downloads, and a filename that
 * is safe to put in a header.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS
 * Two silent production failures are pinned here.
 *
 * 1. `<a href={url} download>` only downloads when `url` is SAME-ORIGIN. The
 *    storage driver changes with the environment: `LocalStorageDriver` returns
 *    `/uploads/<key>` (same-origin, works), `S3StorageDriver` returns an
 *    absolute `https://…` URL (cross-origin, so the attribute is ignored and
 *    the browser navigates instead). So "click the picture to download it"
 *    worked in development and quietly stopped working once deployed. The
 *    `/api/download` proxy exists to make the behaviour identical in both, and
 *    `downloadUrl()` is what points at it.
 *
 * 2. The filename is attacker-controlled — it is whatever the sender's client
 *    uploaded — and it lands in a `Content-Disposition` header. A `"` or a
 *    newline there is a response-splitting vector, and `/`, `\` and a trailing
 *    dot are rejected or silently rewritten by Windows. The sanitiser is
 *    tested against all of those rather than the happy path.
 */
import { describe, expect, it } from 'vitest';
import {
  contentDisposition,
  downloadFileName,
  downloadUrl,
  extensionForMime,
  safeFileName,
} from '@/lib/download';

describe('safeFileName', () => {
  it('keeps only the last path segment', () => {
    expect(safeFileName('/etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Users\\me\\Pictures\\a.png')).toBe('a.png');
    expect(safeFileName('../../secrets.txt')).toBe('secrets.txt');
  });

  it('replaces every character Windows refuses, and the quoting characters', () => {
    expect(safeFileName('a"b<c>d:e|f?g*h.png')).toBe('a b c d e f g h.png');
  });

  it('strips control characters, which are the header-injection vector', () => {
    expect(safeFileName('a\u0000b\u001fc\u007fd.png')).toBe('a b c d.png');
  });

  it('cannot smuggle a second header through the name', () => {
    const hostile = 'a"b\r\nX-Evil: 1.png';
    const cleaned = safeFileName(hostile);

    expect(cleaned).not.toContain('\r');
    expect(cleaned).not.toContain('\n');
    expect(cleaned).not.toContain('"');
    expect(cleaned).not.toContain(':');
    expect(cleaned).toBe('a b X-Evil 1.png');
  });

  it('collapses whitespace and trims', () => {
    expect(safeFileName('  a    b.png  ')).toBe('a b.png');
  });

  it('drops trailing dots and spaces, which Windows would strip anyway', () => {
    // A name that does not survive the round trip can collide with another.
    expect(safeFileName('report.')).toBe('report');
    expect(safeFileName('report. . ')).toBe('report');
  });

  it('falls back when nothing usable is left', () => {
    expect(safeFileName(null)).toBe('avomessage-file');
    expect(safeFileName(undefined)).toBe('avomessage-file');
    expect(safeFileName('   ')).toBe('avomessage-file');
    expect(safeFileName('...')).toBe('avomessage-file');
    expect(safeFileName(null, 'png')).toBe('avomessage-file.png');
    expect(safeFileName(undefined, 'webm')).toBe('avomessage-file.webm');
  });

  it('truncates the stem but never the extension', () => {
    const long = `${'x'.repeat(200)}.png`;
    const cleaned = safeFileName(long);

    expect(cleaned.length).toBeLessThanOrEqual(120);
    expect(cleaned.endsWith('.png')).toBe(true);
  });

  it('truncates a long name that has no extension at all', () => {
    const cleaned = safeFileName('x'.repeat(200));
    expect(cleaned).toHaveLength(120);
  });

  it('does not mistake a long tail for an extension', () => {
    // 21 characters after the dot is not an extension, so nothing is preserved.
    const cleaned = safeFileName(`${'x'.repeat(115)}.${'y'.repeat(20)}`);
    expect(cleaned.length).toBeLessThanOrEqual(120);
    expect(cleaned.endsWith('.yyyyyyyyyyyyyyyyyyyy')).toBe(false);
  });
});

describe('extensionForMime', () => {
  it('maps the media types the app actually uploads', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/webp')).toBe('webp');
    expect(extensionForMime('audio/webm')).toBe('webm');
    expect(extensionForMime('application/pdf')).toBe('pdf');
  });

  it('ignores parameters, case and surrounding space', () => {
    expect(extensionForMime('image/png; charset=utf-8')).toBe('png');
    expect(extensionForMime('IMAGE/JPEG')).toBe('jpg');
    expect(extensionForMime('  audio/mpeg  ')).toBe('mp3');
  });

  it('returns nothing for a type it does not know', () => {
    expect(extensionForMime('application/octet-stream')).toBe('');
    expect(extensionForMime(null)).toBe('');
    expect(extensionForMime(undefined)).toBe('');
    expect(extensionForMime('')).toBe('');
  });
});

describe('downloadFileName', () => {
  it('prefers the name the uploader gave it', () => {
    expect(
      downloadFileName({ name: 'holiday photo.jpg', url: 'https://x/y.png', mimeType: 'image/png' }),
    ).toBe('holiday photo.jpg');
  });

  it('gives an extensionless name one, because a file with no extension cannot be opened', () => {
    expect(downloadFileName({ name: 'screenshot', url: 'https://x/y', mimeType: 'image/png' })).toBe(
      'screenshot.png',
    );
  });

  it('leaves a name alone when no extension can be derived', () => {
    expect(downloadFileName({ name: 'notes', url: 'https://x/y', mimeType: null })).toBe('notes');
  });

  it('falls back to the URL when there is no name', () => {
    expect(downloadFileName({ name: null, url: 'https://bucket.s3.amazonaws.com/abc123.webp' })).toBe(
      'abc123.webp',
    );
  });

  it('names each unnamed file after its own URL, so two downloads do not collide', () => {
    // The regression this guards: every unnamed attachment used to be called
    // "avomessage-file", so a Downloads folder filled up with
    // "avomessage-file (1)", "avomessage-file (2)", … and the user could not
    // tell which was which.
    const first = downloadFileName({ url: 'https://bucket.s3.amazonaws.com/aaa111.webp' });
    const second = downloadFileName({ url: 'https://bucket.s3.amazonaws.com/bbb222.webp' });

    expect(first).toBe('aaa111.webp');
    expect(second).toBe('bbb222.webp');
    expect(first).not.toBe(second);
  });

  it('reads the extension through a query string', () => {
    expect(downloadFileName({ name: null, url: 'https://x/a.png?token=abc&t=1' })).toBe('a.png');
  });

  it('prefers the URL extension over the MIME type', () => {
    expect(downloadFileName({ name: null, url: 'https://x/clip.webm', mimeType: 'audio/mpeg' })).toBe(
      'clip.webm',
    );
  });

  it('ignores an absurd tail masquerading as an extension', () => {
    expect(
      downloadFileName({ name: null, url: 'https://x/a.verylongextension', mimeType: 'audio/webm' }),
    ).toBe('avomessage-file.webm');
  });

  it('uses the prefix for a clip with no name and no extension in its URL', () => {
    expect(
      downloadFileName({ url: 'https://x/abc', mimeType: 'audio/webm', prefix: 'voice-message' }),
    ).toBe('voice-message.webm');
  });

  it('falls back to .bin when nothing is known', () => {
    expect(downloadFileName({ url: 'https://x/abc' })).toBe('avomessage-file.bin');
    expect(downloadFileName({ url: 'https://x/abc', prefix: 'voice-message' })).toBe(
      'voice-message.bin',
    );
  });

  it('sanitises a hostile name even when it comes from the uploader', () => {
    expect(
      downloadFileName({ name: '../../a"b\r\nX-Evil: 1.png', url: 'https://x/y', mimeType: null }),
    ).toBe('a b X-Evil 1.png');
  });
});

describe('downloadUrl', () => {
  it('points at the same-origin proxy, because `download` is ignored cross-origin', () => {
    // An S3 URL — the production case.
    const result = downloadUrl('https://bucket.s3.amazonaws.com/a.png', 'a.png');

    expect(result.startsWith('/api/download?')).toBe(true);
    // Not the raw S3 URL: the browser would navigate to that instead.
    expect(result).not.toContain('s3.amazonaws.com?');
  });

  it('carries the original URL intact, even when it has its own query', () => {
    const original = 'https://x/a.png?token=abc&t=1';
    const result = downloadUrl(original, 'a.png');
    const parsed = new URL(result, 'https://app.example');

    expect(parsed.pathname).toBe('/api/download');
    expect(parsed.searchParams.get('url')).toBe(original);
    expect(parsed.searchParams.get('name')).toBe('a.png');
  });

  it('encodes the parameters rather than splicing them in', () => {
    const result = downloadUrl('/uploads/a b.png', 'a b.png');
    expect(result).toBe('/api/download?url=%2Fuploads%2Fa+b.png&name=a+b.png');
  });

  it('omits the name when there is none', () => {
    expect(downloadUrl('/uploads/x.png')).toBe('/api/download?url=%2Fuploads%2Fx.png');
  });

  it('returns an empty URL unchanged, so the caller gets a dead link rather than a broken route', () => {
    expect(downloadUrl('')).toBe('');
  });
});

describe('contentDisposition', () => {
  /** Pull the plain `filename=` value out of the header. */
  function asciiForm(value: string): string {
    const match = /filename="([^"]*)"/.exec(value);
    expect(match, `no filename= in ${value}`).not.toBeNull();
    return match![1]!;
  }

  /** Pull and decode the RFC 5987 `filename*=` value. */
  function extendedForm(value: string): string {
    const match = /filename\*=UTF-8''([^;]*)/.exec(value);
    expect(match, `no filename*= in ${value}`).not.toBeNull();
    return decodeURIComponent(match![1]!);
  }

  it('forces a download rather than a navigation', () => {
    expect(contentDisposition('photo.png').startsWith('attachment; ')).toBe(true);
  });

  it('emits both the ASCII and the extended form', () => {
    const value = contentDisposition('photo.png');
    expect(value).toBe(`attachment; filename="photo.png"; filename*=UTF-8''photo.png`);
  });

  it('keeps the plain form ASCII-only, which old clients require', () => {
    const value = contentDisposition('ছবি.png');
    const ascii = asciiForm(value);

    expect(/^[\x20-\x7e]*$/.test(ascii)).toBe(true);
    expect(ascii.endsWith('.png')).toBe(true);
  });

  it('carries a Bengali filename through the extended form intact', () => {
    // The whole point of sending `filename*=`: without it the user gets
    // underscores instead of their file's name.
    const value = contentDisposition('ছবি.png');

    expect(extendedForm(value)).toBe('ছবি.png');
    expect(value).toContain('%E0%A6%9B');
  });

  it('percent-escapes the characters RFC 5987 does not allow unquoted', () => {
    // encodeURIComponent leaves `'`, `(` and `)` alone, so they have to be
    // escaped by hand. `*` is also in that set but never gets this far —
    // `safeFileName` strips it first, because Windows refuses it in a name.
    const value = contentDisposition("a'b(c)d.png");
    expect(value).toContain("filename*=UTF-8''a%27b%28c%29d.png");
  });

  it('cannot be split into a second header', () => {
    const value = contentDisposition('a"b\r\nX-Evil: 1.png');

    expect(value).not.toContain('\r');
    expect(value).not.toContain('\n');
    // Exactly one quoted pair — the `filename=` value, and nothing else.
    expect(value.match(/"/g)).toHaveLength(2);
    expect(asciiForm(value)).toBe('a b X-Evil 1.png');
  });

  it('sanitises before quoting, so a path cannot survive into the header', () => {
    const value = contentDisposition('../../etc/passwd');
    expect(asciiForm(value)).toBe('passwd');
  });

  it('round-trips the extended form for a hostile name', () => {
    const value = contentDisposition('a"b\r\nX-Evil: 1.png');
    expect(extendedForm(value)).toBe('a b X-Evil 1.png');
  });
});
