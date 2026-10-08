import { NextResponse, type NextRequest } from 'next/server';
import { handle, ok, ValidationError, NotFoundError } from '@/lib/api';
import { requireSession } from '@/lib/permissions';
import { contentDisposition, downloadFileName, safeFileName } from '@/lib/download';

/**
 * GET /api/download?url=<url>&name=<filename>
 *
 * Streams an attachment back as a download, from OUR origin.
 *
 * WHY A PROXY AND NOT JUST `<a download>`
 * The `download` attribute on a link is only honoured for same-origin URLs. The
 * local storage driver returns `/uploads/<key>` (same-origin, so it works), but
 * the S3 driver — the one production uses — returns an absolute `https://…`
 * URL. On a cross-origin URL the browser ignores `download` and navigates, so
 * "click the picture to download it" worked in development and quietly stopped
 * working once deployed. `Content-Disposition: attachment` from our own origin
 * is the only mechanism that behaves the same in both.
 *
 * SSRF IS THE REAL RISK HERE
 * A route that fetches a URL supplied by the caller is an open proxy unless it
 * is constrained, and an unconstrained one can reach cloud metadata endpoints
 * (`169.254.169.254`), internal services, and `file://`-adjacent schemes. So:
 *
 *   - only `http:` and `https:` are accepted;
 *   - the host must be one this deployment actually serves files from;
 *   - redirects are followed but the FINAL url is re-checked, because
 *     otherwise an allowlisted host could bounce us anywhere;
 *   - the upstream request carries no cookies and no caller headers.
 *
 * The route also requires a session. Attachments are user content and there is
 * no reason for an anonymous caller to be able to use this as a fetcher.
 */

/** Longest we will relay. Matches the upload ceiling in lib/services/uploads.ts. */
const MAX_BYTES = 110 * 1024 * 1024;

/** How long to wait on the origin before giving up. */
const FETCH_TIMEOUT_MS = 20_000;

/** Hosts this deployment serves files from. */
function allowedHosts(req: NextRequest): Set<string> {
  const hosts = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value) return;
    try {
      hosts.add(new URL(value).host.toLowerCase());
    } catch {
      /* a malformed env var must not widen the allowlist */
    }
  };
  add(process.env.APP_URL);
  add(process.env.S3_PUBLIC_URL);
  add(process.env.S3_ENDPOINT);
  // The host this request arrived on — covers a relative URL, and a deployment
  // whose APP_URL was never set.
  const host = req.headers.get('host');
  if (host) hosts.add(host.toLowerCase());
  return hosts;
}

/** Resolve the caller's `url` parameter, or explain why it is refused. */
function resolveTarget(req: NextRequest, raw: string, allowed: Set<string>): URL {
  let target: URL;
  try {
    // A relative path is resolved against this request's own origin, which is
    // how the local storage driver's `/uploads/<key>` URLs arrive.
    target = new URL(raw, req.nextUrl.origin);
  } catch {
    throw new ValidationError('Invalid url', { url: ['Not a valid URL'] });
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new ValidationError('Unsupported url scheme', {
      url: ['Only http and https are supported'],
    });
  }
  if (!allowed.has(target.host.toLowerCase())) {
    throw new ValidationError('Refused url', {
      url: ['That host is not a file host for this deployment'],
    });
  }
  return target;
}

export const GET = handle(async (req: NextRequest): Promise<NextResponse> => {
  await requireSession(req);

  const params = req.nextUrl.searchParams;
  const raw = params.get('url')?.trim();
  if (!raw) throw new ValidationError('Missing url', { url: ['A url is required'] });

  const allowed = allowedHosts(req);
  const target = resolveTarget(req, raw, allowed);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      // No cookies, no caller headers: this is our server fetching a file, not
      // the user's browser proxied.
      headers: { accept: '*/*' },
      redirect: 'follow',
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch {
    clearTimeout(timer);
    throw new NotFoundError('Could not read that file');
  }
  clearTimeout(timer);

  // `redirect: 'follow'` means the response may come from somewhere other than
  // `target`; without this check an allowlisted host could redirect us to an
  // internal address and the allowlist would mean nothing.
  if (!allowed.has(new URL(upstream.url || target.href).host.toLowerCase())) {
    throw new ValidationError('Refused redirect', {
      url: ['The file host redirected to an unexpected host'],
    });
  }

  if (!upstream.ok || !upstream.body) {
    throw new NotFoundError('File not found');
  }

  const declaredLength = Number.parseInt(upstream.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
    throw new ValidationError('File too large to download');
  }

  const fileName = safeFileName(
    downloadFileName({
      name: params.get('name'),
      url: target.href,
      mimeType: upstream.headers.get('content-type'),
    }),
  );

  const headers = new Headers({
    // The upstream type is kept so an image or audio file opens correctly from
    // the user's Downloads folder; `attachment` is what forces the save.
    'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
    'Content-Disposition': contentDisposition(fileName),
    // Never let a served file be sniffed into something executable.
    'X-Content-Type-Options': 'nosniff',
    // A download is per-user content; a shared cache must not hold it.
    'Cache-Control': 'private, no-store',
  });
  if (upstream.headers.has('content-length')) {
    headers.set('Content-Length', upstream.headers.get('content-length')!);
  }

  return new NextResponse(upstream.body, { status: 200, headers });
}, { rateLimit: 'read' });

/**
 * The name a browser should suggest, so the UI can show it before the click
 * (and so tests can assert the derivation without a download).
 */
export const POST = handle(async (req: NextRequest): Promise<NextResponse> => {
  await requireSession(req);
  const body = (await req.json().catch(() => null)) as
    | { url?: unknown; name?: unknown; mimeType?: unknown; prefix?: unknown }
    | null;
  const url = typeof body?.url === 'string' ? body.url : '';
  if (!url) throw new ValidationError('Missing url', { url: ['A url is required'] });

  return ok({
    fileName: downloadFileName({
      name: typeof body?.name === 'string' ? body.name : null,
      url,
      mimeType: typeof body?.mimeType === 'string' ? body.mimeType : null,
      prefix: typeof body?.prefix === 'string' ? body.prefix : undefined,
    }),
  });
}, { rateLimit: 'read' });
