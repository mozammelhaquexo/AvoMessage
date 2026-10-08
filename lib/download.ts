/**
 * lib/download.ts — building a download link that actually downloads.
 *
 * THE PROBLEM
 * `<a href={url} download="name">` only downloads when `url` is SAME-ORIGIN.
 * For any cross-origin URL the `download` attribute is ignored and the browser
 * navigates instead — which is fine for a PDF (it opens a tab) and useless for
 * an image or a voice note (the user gets a viewer, not a file).
 *
 * That matters here because the storage driver changes with the environment:
 * `LocalStorageDriver` returns `/uploads/<key>` (same-origin), while
 * `S3StorageDriver` returns an absolute `https://…` URL (cross-origin, and in
 * production it is the one in use). So the same markup downloads in development
 * and silently stops working once deployed — the worst kind of difference to
 * find by hand.
 *
 * THE FIX
 * `downloadUrl()` points at `/api/download`, a same-origin route that streams
 * the bytes back with `Content-Disposition: attachment`. The `download`
 * attribute becomes irrelevant because the header does the work.
 *
 * Everything here is a pure function so the awkward parts — turning an arbitrary
 * attachment name into something safe for a `Content-Disposition` header and a
 * Windows filesystem — can be tested without a browser or a server.
 */

/** Longest filename we will emit, extension included. */
const MAX_NAME_LENGTH = 120;

/** Fallback when nothing usable can be derived. */
const FALLBACK_STEM = 'avomessage-file';

/** Characters Windows refuses in a filename, plus the quoting characters. */
const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

/** A small, honest map for the common media types. */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
};

/**
 * Turn anything into a filename that is safe in a header and on disk.
 *
 * Why so defensive: this value reaches `Content-Disposition`, where a quote or a
 * newline lets an attacker inject a second header, and it also becomes the name
 * on the user's disk, where `/`, `\` and a trailing dot are rejected or
 * silently rewritten. Neither is a hypothetical — the attachment name is
 * whatever the sender's client uploaded.
 */
export function safeFileName(raw: string | null | undefined, fallbackExt = ''): string {
  const base = (raw ?? '')
    // A name can arrive as a full path; only the last segment is a name.
    .split(/[/\\]/)
    .pop()!
    .replace(ILLEGAL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows strips trailing dots and spaces, so a name ending in one would
    // not survive a round trip and could collide with another file.
    .replace(/[. ]+$/, '');

  if (!base) {
    return fallbackExt ? `${FALLBACK_STEM}.${fallbackExt}` : FALLBACK_STEM;
  }

  if (base.length <= MAX_NAME_LENGTH) return base;

  // Truncate the stem, never the extension — a 200-character name with the
  // `.png` cut off is not a usable image.
  const dot = base.lastIndexOf('.');
  const hasExt = dot > 0 && base.length - dot <= 12;
  const ext = hasExt ? base.slice(dot) : '';
  const stem = hasExt ? base.slice(0, dot) : base;
  return stem.slice(0, Math.max(1, MAX_NAME_LENGTH - ext.length)) + ext;
}

/** The extension for a MIME type, or '' when it is not one we recognise. */
export function extensionForMime(mimeType: string | null | undefined): string {
  if (!mimeType) return '';
  return EXTENSION_BY_MIME[mimeType.split(';')[0]!.trim().toLowerCase()] ?? '';
}

/** The last path segment of a URL, ignoring any query string or fragment. */
function lastPathSegment(url: string): string {
  const path = url.split(/[?#]/)[0] ?? '';
  return path.split('/').pop() ?? '';
}

/** The extension already present in a URL path, lowercased, or ''. */
function extensionFromUrl(url: string): string {
  const last = lastPathSegment(url);
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return '';
  const ext = last.slice(dot + 1).toLowerCase();
  // Guard against a query-ish tail or an absurd "extension".
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

/** Whether a filename already carries an extension we can trust. */
function hasExtension(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  // `dot > 0` rules out a dotfile (`.gitignore` is a name, not an extension),
  // and the second half rules out a trailing dot.
  return dot > 0 && dot < fileName.length - 1;
}

/**
 * The name to save an attachment under.
 *
 * In order of preference:
 *
 *   1. the name the uploader gave it;
 *   2. the URL's own last path segment, when it looks like a filename;
 *   3. a caller-supplied stem (`prefix`), e.g. "voice-message";
 *   4. a generic stem.
 *
 * Always with an extension, because a downloaded file with no extension is a
 * file the user cannot open — enforced even when the uploader supplied the
 * name, so an attachment called `screenshot` with an `image/png` type becomes
 * `screenshot.png`.
 *
 * The URL segment is preferred over `prefix` because it is unique per file:
 * naming every unnamed image `avomessage-file` means saving three of them
 * produces "avomessage-file", "avomessage-file (1)" and "avomessage-file (2)",
 * which is useless in a Downloads folder.
 */
export function downloadFileName(options: {
  name?: string | null;
  url: string;
  mimeType?: string | null;
  /** Used when the URL gives no clue, e.g. "voice-message". */
  prefix?: string;
}): string {
  const { name, url, mimeType, prefix } = options;
  const fromMime = extensionForMime(mimeType);
  const fromUrl = extensionFromUrl(url);
  const ext = fromUrl || fromMime;

  if (name && name.trim()) {
    const cleaned = safeFileName(name, ext);
    if (hasExtension(cleaned) || !ext) return cleaned;
    return `${cleaned}.${ext}`;
  }

  // `fromUrl` is required as well as a non-empty segment: a segment with no
  // usable extension (`/abc`, `/a.verylongextension`) is a storage key, not a
  // filename, and would make a poor one.
  const urlName = safeFileName(lastPathSegment(url));
  if (fromUrl && urlName !== FALLBACK_STEM) return urlName;

  if (prefix) return safeFileName(`${prefix}.${ext || 'bin'}`, ext || 'bin');
  return safeFileName(null, ext || 'bin');
}

/**
 * The same-origin URL that forces a download.
 *
 * Returns the original URL untouched when there is nothing to download from —
 * better a link that opens than a link that 404s.
 */
export function downloadUrl(url: string, name?: string | null): string {
  if (!url) return url;
  const params = new URLSearchParams({ url });
  if (name) params.set('name', name);
  return `/api/download?${params.toString()}`;
}

/**
 * The `Content-Disposition` value for a filename.
 *
 * Emits BOTH forms on purpose. `filename=` must be ASCII-only for old clients,
 * so a non-ASCII name is replaced character-for-character with `_` there and
 * the real name is carried in `filename*=` (RFC 5987), which every current
 * browser prefers. Send only the ASCII form and a Bengali or Arabic filename
 * arrives as underscores; send only the extended form and an ancient client
 * saves the literal percent-escaped string.
 */
export function contentDisposition(fileName: string): string {
  const safe = safeFileName(fileName, 'bin');
  // `\x20-\x7e` is the printable ASCII range, so nothing here matches a
  // control character and `no-control-regex` has nothing to complain about.
  // The quote replacement below should never fire — `safeFileName` has already
  // removed every `"` — but it is the last thing standing between an
  // attacker-supplied name and a second header, so it stays.
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");

  // `encodeURIComponent` leaves `'`, `(`, `)` and `*` alone, and RFC 5987 does
  // not allow them unquoted in an extended value, so escape them by hand.
  // (`*` never actually reaches here — `safeFileName` strips it, because
  // Windows refuses it in a filename — but the regex is the last guard if that
  // character class is ever relaxed.)
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
