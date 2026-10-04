/**
 * Storage abstraction (ARCHITECTURE.md §4).
 *
 *   STORAGE_DRIVER=local → LocalStorageDriver: files under STORAGE_LOCAL_DIR
 *     (default ./storage/uploads), served by GET /uploads/[...path].
 *   STORAGE_DRIVER=s3    → S3StorageDriver: S3-compatible (AWS/MinIO) with
 *     hand-rolled SigV4 signing (no extra deps). Keys look like
 *     <kind>/<yyyy>/<mm>/<uuid>-<sanitized-name>.
 *
 * All uploads go through `validateUpload()` BEFORE `put()`: MIME + extension
 * + size + magic-byte sniffing, server-side. SVG is never allowed (XSS).
 */
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { UploadKind } from '@/lib/validation';

export interface PutOptions {
  contentType: string;
  size: number;
}

export interface StorageDriver {
  put(key: string, data: Buffer, opts: PutOptions): Promise<{ url: string }>;
  delete(key: string): Promise<void>;
  getUrl(key: string): string;
}

// ─── Validation (lib/storage/validate.ts in the arch doc lives here) ────────

interface KindRule {
  maxBytes: number;
  mimes: string[];
  /** Magic-byte families accepted for this kind. */
  magic: Array<'jpeg' | 'png' | 'gif' | 'webp' | 'mp4' | 'webm' | 'pdf' | 'zip' | 'mp3' | 'ogg' | 'txt'>;
  extensions: string[];
}

const MB = 1024 * 1024;

export const UPLOAD_RULES: Record<UploadKind, KindRule> = {
  avatar: {
    maxBytes: 5 * MB,
    mimes: ['image/jpeg', 'image/png', 'image/webp'],
    magic: ['jpeg', 'png', 'webp'],
    extensions: ['jpg', 'jpeg', 'png', 'webp'],
  },
  cover: {
    maxBytes: 5 * MB,
    mimes: ['image/jpeg', 'image/png', 'image/webp'],
    magic: ['jpeg', 'png', 'webp'],
    extensions: ['jpg', 'jpeg', 'png', 'webp'],
  },
  'company-logo': {
    maxBytes: 5 * MB,
    mimes: ['image/jpeg', 'image/png', 'image/webp'],
    magic: ['jpeg', 'png', 'webp'],
    extensions: ['jpg', 'jpeg', 'png', 'webp'],
  },
  post: {
    maxBytes: 100 * MB,
    mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'],
    magic: ['jpeg', 'png', 'webp', 'gif', 'mp4', 'webm'],
    extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm'],
  },
  message: {
    maxBytes: 25 * MB,
    mimes: [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain', 'text/markdown', 'text/csv', 'application/zip',
    ],
    magic: ['jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'pdf', 'zip', 'txt'],
    extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'zip'],
  },
  voice: {
    maxBytes: 10 * MB,
    mimes: ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg'],
    magic: ['webm', 'mp4', 'mp3', 'ogg'],
    extensions: ['webm', 'm4a', 'mp3', 'ogg'],
  },
};

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadValidationError';
  }
}

/** Detect the file family from magic bytes (first bytes of the buffer). */
export function sniffMagic(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  const head = buffer.subarray(0, 12);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) return 'gif';
  if (
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) return 'webp';
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return 'mp4';
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'webm';
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05)) return 'zip';
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return 'mp3';
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return 'mp3';
  if (head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53) return 'ogg';
  // Plain text: no NUL bytes in the first 512 bytes.
  if (!buffer.subarray(0, Math.min(512, buffer.length)).includes(0)) return 'txt';
  return null;
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 100);
  return cleaned || 'file';
}

/** Storage key: <kind>/<yyyy>/<mm>/<uuid>-<sanitized-name> */
export function buildStorageKey(kind: UploadKind, filename: string, now = new Date()): string {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${kind}/${yyyy}/${mm}/${randomUUID()}-${sanitizeFilename(filename)}`;
}

export interface ValidatedUpload {
  kind: UploadKind;
  mimeType: string;
  sizeBytes: number;
  key: string;
}

/** Expected magic signatures per declared MIME type (office docs are OOXML zips). */
const MIME_TO_MAGIC: Record<string, string[]> = {
  'image/jpeg': ['jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'video/mp4': ['mp4'],
  'video/webm': ['webm'],
  'application/pdf': ['pdf'],
  'application/zip': ['zip'],
  'application/msword': ['zip'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['zip'],
  'application/vnd.ms-excel': ['zip'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['zip'],
  'application/vnd.ms-powerpoint': ['zip'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['zip'],
  'text/plain': ['txt'],
  'text/markdown': ['txt'],
  'text/csv': ['txt'],
  'audio/webm': ['webm'],
  'audio/mp4': ['mp4'],
  'audio/mpeg': ['mp3'],
  'audio/ogg': ['ogg'],
};

/**
 * Server-side upload validation. Throws UploadValidationError on any failure.
 * SVG is rejected outright (XSS via embedded scripts).
 */
export function validateUpload(
  kind: UploadKind,
  filename: string,
  mimeType: string,
  buffer: Buffer,
): ValidatedUpload {
  const rule = UPLOAD_RULES[kind];
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  // MIME parameters (e.g. `audio/webm;codecs=opus`) are stripped for allow-list
  // and magic-byte lookup so codec-aware MediaRecorder output still validates.
  const baseMime = mimeType.split(';')[0].trim().toLowerCase();

  if (ext === 'svg' || baseMime === 'image/svg+xml') {
    throw new UploadValidationError('SVG uploads are not allowed');
  }
  if (!rule.mimes.includes(baseMime)) {
    throw new UploadValidationError(`MIME type ${mimeType} is not allowed for ${kind} uploads`);
  }
  if (!rule.extensions.includes(ext)) {
    throw new UploadValidationError(`File extension .${ext} is not allowed for ${kind} uploads`);
  }
  if (buffer.length === 0) {
    throw new UploadValidationError('Empty file');
  }
  if (buffer.length > rule.maxBytes) {
    throw new UploadValidationError(
      `File too large: ${(buffer.length / MB).toFixed(1)}MB exceeds the ${rule.maxBytes / MB}MB limit for ${kind}`,
    );
  }
  const magic = sniffMagic(buffer);
  // Content must match the DECLARED mime type (not just the kind's allow-list),
  // so a jpeg renamed to .png with mime image/png is rejected.
  const expected = MIME_TO_MAGIC[baseMime] ?? rule.magic;
  if (!magic || !expected.includes(magic)) {
    throw new UploadValidationError('File content does not match its declared type');
  }
  return { kind, mimeType, sizeBytes: buffer.length, key: buildStorageKey(kind, filename) };
}

// ─── Local driver (dev) ─────────────────────────────────────────────────────

function localBaseDir(): string {
  // Resolve to absolute so path-traversal prefix checks work regardless of
  // whether STORAGE_LOCAL_DIR was set as `./storage/uploads` or a Windows path.
  const raw = process.env.STORAGE_LOCAL_DIR ?? join(process.cwd(), 'storage', 'uploads');
  return resolve(raw);
}

export class LocalStorageDriver implements StorageDriver {
  constructor(private readonly baseDir: string = localBaseDir()) {}

  private resolveKey(key: string): string {
    const normalized = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    const full = resolve(this.baseDir, normalized);
    // Compare against the resolved baseDir (handles case-insensitive Windows
    // volumes and trailing separators).
    const baseWithSep = this.baseDir.endsWith(sep) ? this.baseDir : this.baseDir + sep;
    if (
      full !== this.baseDir &&
      !full.toLowerCase().startsWith(baseWithSep.toLowerCase())
    ) {
      throw new Error('Invalid storage key (path traversal)');
    }
    return full;
  }

  async put(key: string, data: Buffer, opts: PutOptions): Promise<{ url: string }> {
    const full = this.resolveKey(key);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, data);
    void opts;
    return { url: this.getUrl(key) };
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolveKey(key)).catch(() => undefined);
  }

  getUrl(key: string): string {
    return `/uploads/${key}`;
  }

  /** For the GET /uploads/[...path] route: resolve a key to a disk path. */
  resolvePublicPath(key: string): string {
    return this.resolveKey(key);
  }
}

// ─── S3 driver (prod) ───────────────────────────────────────────────────────

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * S3-compatible driver with hand-rolled AWS Signature V4 (no extra deps).
 * Env: S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY,
 *      S3_PUBLIC_URL (optional CDN prefix).
 */
export class S3StorageDriver implements StorageDriver {
  private readonly endpoint: string;
  private readonly region: string;
  private readonly bucket: string;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly publicUrl?: string;

  constructor() {
    const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_PUBLIC_URL } = process.env;
    if (!S3_ENDPOINT || !S3_REGION || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
      throw new Error('S3_ENDPOINT/S3_REGION/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY must be set for the s3 driver');
    }
    this.endpoint = S3_ENDPOINT.replace(/\/$/, '');
    this.region = S3_REGION;
    this.bucket = S3_BUCKET;
    this.accessKey = S3_ACCESS_KEY;
    this.secretKey = S3_SECRET_KEY;
    this.publicUrl = S3_PUBLIC_URL?.replace(/\/$/, '');
  }

  private sign(method: string, key: string, contentType: string, payloadHash: string): Record<string, string> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]/g, '').slice(0, 15) + 'Z';
    const dateStamp = amzDate.slice(0, 8);
    const host = new URL(this.endpoint).host;
    const canonicalUri = `/${this.bucket}/${key}`;
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
    const canonicalHeaders =
      `content-type:${contentType}\nhost:${host}\n` +
      `x-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const canonicalRequest = [
      method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash,
    ].join('\n');
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
    const kDate = hmacSha256(`AWS4${this.secretKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, this.region);
    const kService = hmacSha256(kRegion, 's3');
    const kSigning = hmacSha256(kService, 'aws4_request');
    const signature = hmacSha256(kSigning, stringToSign).toString('hex');
    return {
      'Content-Type': contentType,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  async put(key: string, data: Buffer, opts: PutOptions): Promise<{ url: string }> {
    const payloadHash = sha256Hex(data);
    const headers = this.sign('PUT', key, opts.contentType, payloadHash);
    const res = await fetch(`${this.endpoint}/${this.bucket}/${key}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Length': String(data.length) },
      body: new Uint8Array(data),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`S3 PUT failed (${res.status}): ${body.slice(0, 500)}`);
    }
    return { url: this.getUrl(key) };
  }

  async delete(key: string): Promise<void> {
    const payloadHash = sha256Hex('');
    const headers = this.sign('DELETE', key, '', payloadHash);
    const res = await fetch(`${this.endpoint}/${this.bucket}/${key}`, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) {
      throw new Error(`S3 DELETE failed (${res.status})`);
    }
  }

  getUrl(key: string): string {
    if (this.publicUrl) return `${this.publicUrl}/${key}`;
    return `${this.endpoint}/${this.bucket}/${key}`;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let driver: StorageDriver | null = null;

/** Storage driver selected by STORAGE_DRIVER env (local | s3). */
export function getStorage(): StorageDriver {
  if (driver) return driver;
  const name = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();
  driver = name === 's3' ? new S3StorageDriver() : new LocalStorageDriver();
  return driver;
}

/** Test hook. */
export function setStorage(d: StorageDriver | null): void {
  driver = d;
}
