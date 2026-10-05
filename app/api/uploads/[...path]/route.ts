import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { handle, RouteContext } from '@/lib/api';
import { LocalStorageDriver, getStorage } from '@/lib/storage';

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  zip: 'application/zip',
};

/**
 * Serves files stored by the local driver (dev). In prod the S3 driver
 * returns absolute URLs and this route is unused. v1: public; private kinds
 * (message attachments, voice) get auth-gating in v2.
 */
export const GET = handle(
  async (req: NextRequest, ctx?: RouteContext<{ path: string[] }>): Promise<NextResponse> => {
    const storage = getStorage();
    if (!(storage instanceof LocalStorageDriver)) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Not found' } },
        { status: 404 },
      );
    }
    const raw = (await ctx?.params)?.path;
    const segments = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    if (segments.length === 0) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Not found' } },
        { status: 404 },
      );
    }
    const key = segments.join('/');
    let data: Buffer;
    try {
      data = await readFile(storage.resolvePublicPath(key));
    } catch {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Not found' } },
        { status: 404 },
      );
    }
    const ext = (key.split('.').pop() ?? '').toLowerCase();
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
        // Never let the browser reinterpret a served file as something
        // else (e.g. a text/plain upload sniffed as HTML → stored XSS).
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
  { rateLimit: false },
);
