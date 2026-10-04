/**
 * Upload validation tests: MIME/extension/size allowlists, SVG rejection,
 * and magic-byte sniffing vs. the declared MIME type.
 *
 * Pure unit tests — no DB required.
 */
import { describe, expect, it } from 'vitest';
import { validateUpload, UploadValidationError } from '@/lib/storage';

function jpegHeader(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 0x42)]);
}
function pdfHeader(): Buffer {
  return Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(100, 0x42)]);
}

describe('validateUpload', () => {
  it('accepts a valid avatar JPEG', () => {
    const out = validateUpload('avatar', 'photo.jpg', 'image/jpeg', jpegHeader());
    expect(out.kind).toBe('avatar');
    expect(out.mimeType).toBe('image/jpeg');
    expect(out.sizeBytes).toBeGreaterThan(0);
    expect(out.key).toMatch(/^avatar\//);
  });

  it('rejects SVG outright (XSS vector)', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(() => validateUpload('avatar', 'evil.svg', 'image/svg+xml', svg)).toThrow(
      UploadValidationError,
    );
    // ... even with a spoofed extension/mime.
    expect(() => validateUpload('post', 'evil.jpg', 'image/jpeg', svg)).toThrow(
      UploadValidationError,
    );
  });

  it('rejects MIME not on the kind allowlist', () => {
    expect(() => validateUpload('avatar', 'clip.mp4', 'video/mp4', Buffer.alloc(100))).toThrow(
      /not allowed for avatar/,
    );
  });

  it('rejects extension not on the kind allowlist', () => {
    expect(() => validateUpload('avatar', 'photo.bmp', 'image/jpeg', jpegHeader())).toThrow(
      /extension/,
    );
  });

  it('rejects content that does not match the declared MIME (spoofed png)', () => {
    expect(() => validateUpload('avatar', 'photo.png', 'image/png', jpegHeader())).toThrow(
      /does not match/,
    );
  });

  it('rejects empty files', () => {
    expect(() => validateUpload('avatar', 'empty.jpg', 'image/jpeg', Buffer.alloc(0))).toThrow(
      /Empty file/,
    );
  });

  it('rejects files over the kind size cap', () => {
    const tooBig = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(6 * 1024 * 1024)]);
    expect(() => validateUpload('avatar', 'big.jpg', 'image/jpeg', tooBig)).toThrow(
      /too large/i,
    );
  });

  it('accepts a PDF as a message attachment', () => {
    const out = validateUpload('message', 'doc.pdf', 'application/pdf', pdfHeader());
    expect(out.kind).toBe('message');
  });

  it('sanitizes the storage key (no path traversal)', () => {
    const out = validateUpload('avatar', '../../etc/passwd.jpg', 'image/jpeg', jpegHeader());
    expect(out.key).not.toContain('..');
    expect(out.key).toMatch(/^avatar\//);
  });
});
