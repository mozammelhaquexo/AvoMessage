/**
 * Shared JSON API helpers — every route handler uses these.
 *
 * Success: resource JSON (status 200/201).
 * Error envelope: `{ error: { code, message, fields? } }` — clients branch on
 * `code`, never on message strings (ARCHITECTURE.md §1).
 *
 * `handle()` wraps a route handler with: rate limiting → CSRF (unsafe methods,
 * unless opted out) → typed error mapping. Route handlers stay thin.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { assertCsrf } from '@/lib/auth/csrf';
import { getClientIp, RATE_LIMITS, checkRateLimit } from '@/lib/rate-limit';

// ─── Error codes ────────────────────────────────────────────────────────────

export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  EMAIL_UNVERIFIED: 'EMAIL_UNVERIFIED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  NOT_FOUND: 'NOT_FOUND',
  GONE: 'GONE',
  CONFLICT: 'CONFLICT',
  CSRF_INVALID: 'CSRF_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_USED: 'TOKEN_USED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_USED: 'OTP_USED',
  OTP_ATTEMPTS_EXCEEDED: 'OTP_ATTEMPTS_EXCEEDED',
  OTP_RESEND_TOO_SOON: 'OTP_RESEND_TOO_SOON',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ─── Typed errors ───────────────────────────────────────────────────────────

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class ValidationError extends HttpError {
  constructor(message = 'Validation failed', fields?: Record<string, string[]>) {
    super(400, ErrorCodes.VALIDATION_ERROR, message, fields);
  }
}
export class UnauthenticatedError extends HttpError {
  constructor(message = 'Authentication required') {
    super(401, ErrorCodes.UNAUTHENTICATED, message);
  }
}
/** Wrong email/password at login — 401, distinct code so clients can branch. */
export class InvalidCredentialsError extends HttpError {
  constructor(message = 'Invalid email or password') {
    super(401, ErrorCodes.INVALID_CREDENTIALS, message);
  }
}
export class ForbiddenError extends HttpError {
  constructor(code: string = ErrorCodes.FORBIDDEN, message = 'Forbidden') {
    super(403, code, message);
  }
}
export class EmailUnverifiedError extends ForbiddenError {
  constructor(message = 'Email verification required') {
    super(ErrorCodes.EMAIL_UNVERIFIED, message);
  }
}
export class SuspendedError extends ForbiddenError {
  constructor(message = 'Account suspended') {
    super(ErrorCodes.ACCOUNT_SUSPENDED, message);
  }
}
export class AccountLockedError extends HttpError {
  constructor(message = 'Account temporarily locked due to too many failed login attempts') {
    super(423, ErrorCodes.ACCOUNT_LOCKED, message);
  }
}
export class NotFoundError extends HttpError {
  constructor(message = 'Not found') {
    super(404, ErrorCodes.NOT_FOUND, message);
  }
}
export class GoneError extends HttpError {
  constructor(message = 'Resource no longer available') {
    super(410, ErrorCodes.GONE, message);
  }
}
export class ConflictError extends HttpError {
  constructor(code: string = ErrorCodes.CONFLICT, message = 'Conflict') {
    super(409, code, message);
  }
}
export class CsrfError extends Error {
  public readonly status = 403;
  public readonly code = ErrorCodes.CSRF_INVALID;
  constructor(message = 'Invalid CSRF token') {
    super(message);
    this.name = 'CsrfError';
  }
}

interface CodedError {
  status: number;
  code: string;
  message: string;
}

function isCodedError(e: unknown): e is CodedError {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as CodedError).status === 'number' &&
    typeof (e as CodedError).code === 'string' &&
    typeof (e as CodedError).message === 'string'
  );
}

/**
 * Prisma unique-constraint violation.
 *
 * The services check for a duplicate first (see `signup` in
 * lib/services/auth.ts), but two concurrent requests can both pass that check
 * and race to the INSERT. Without this the loser surfaced as a 500 "Internal
 * server error"; a 409 with the offending field is both truthful and
 * actionable.
 */
function uniqueViolationTarget(e: unknown): string | null | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const err = e as { code?: unknown; meta?: { target?: unknown } };
  if (err.code !== 'P2002') return undefined;
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.join(', ');
  if (typeof target === 'string') return target;
  return null;
}
export class RateLimitedError extends HttpError {
  constructor(retryAfterMs: number) {
    super(429, ErrorCodes.RATE_LIMITED, 'Too many requests', undefined);
    this.retryAfterMs = retryAfterMs;
  }
  public readonly retryAfterMs: number;
}

// ─── Response helpers ───────────────────────────────────────────────────────

export function ok<T>(data: T, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json(data, { status, headers });
}

export function created<T>(data: T): NextResponse {
  return ok(data, 201);
}

export function err(
  code: string,
  message: string,
  status = 400,
  fields?: Record<string, string[]>,
): NextResponse {
  return NextResponse.json({ error: { code, message, fields } }, { status });
}

export function toErrorResponse(e: unknown): NextResponse {
  if (e instanceof RateLimitedError) {
    const res = err(e.code, e.message, e.status);
    res.headers.set('Retry-After', String(Math.ceil(e.retryAfterMs / 1000)));
    return res;
  }
  if (e instanceof HttpError) {
    return err(e.code, e.message, e.status, e.fields);
  }
  // Structural fallback: domain modules (e.g. lib/auth/csrf.ts) throw their
  // own coded errors to avoid import cycles with this module.
  if (isCodedError(e)) {
    return err(e.code, e.message, e.status);
  }
  if (e instanceof ZodError) {
    return err(ErrorCodes.VALIDATION_ERROR, 'Validation failed', 400, zodFields(e));
  }
  const uniqueTarget = uniqueViolationTarget(e);
  if (uniqueTarget !== undefined) {
    const field = uniqueTarget?.split(', ')[0];
    return err(
      ErrorCodes.CONFLICT,
      field === 'username'
        ? 'This username is already taken'
        : field === 'email'
          ? 'This email is already registered'
          : 'That value is already taken',
      409,
    );
  }
  // Never leak internals.
  console.error('[api] unhandled error', e);
  return err(ErrorCodes.INTERNAL_ERROR, 'Internal server error', 500);
}

export function zodFields(e: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of e.issues) {
    const key = issue.path.join('.') || '_';
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

// ─── Pagination ─────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface PaginationParams {
  limit: number;
  cursor: string | null;
}

/** Reads `?limit=` (default 20, max 100) and `?cursor=` from the request URL. */
export function getPaginationParams(req: NextRequest): PaginationParams {
  const url = new URL(req.url);
  const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  return { limit, cursor: url.searchParams.get('cursor') };
}

/**
 * Opaque cursor codec: base64url(JSON({ c: createdAtISO, i: id })).
 * Stable under inserts; lists order by (createdAt DESC, id DESC).
 */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ c: createdAt.toISOString(), i: id })).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
    c: string;
    i: string;
  };
  const createdAt = new Date(parsed.c);
  if (Number.isNaN(createdAt.getTime()) || typeof parsed.i !== 'string' || !parsed.i) {
    throw new ValidationError('Invalid cursor');
  }
  return { createdAt, id: parsed.i };
}

export interface Paginated<T> {
  data: T[];
  nextCursor: string | null;
}

export function paginated<T>(data: T[], nextCursor: string | null): Paginated<T> {
  return { data, nextCursor };
}

// ─── Route handler wrapper ──────────────────────────────────────────────────

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface HandleOptions {
  /** Set false for pre-auth mutations that cannot present a CSRF token yet
   *  (signup, login, verify-email, forgot/reset-password). Default true. */
  csrf?: boolean;
  /** Override the rate-limit preset; false disables. Default is inferred. */
  rateLimit?: keyof typeof RATE_LIMITS | false;
}

export type RouteContext<TParams extends Record<string, string | string[]> = Record<string, string>> = {
  params?: Promise<TParams>;
};

function inferRateLimitPreset(req: NextRequest): keyof typeof RATE_LIMITS | null {
  const pathname = new URL(req.url).pathname;
  if (pathname.startsWith('/api/auth/')) return 'auth';
  if (req.method === 'GET' || req.method === 'HEAD') return 'read';
  if (pathname === '/api/uploads' && req.method === 'POST') return 'upload';
  return 'write';
}

/**
 * Wraps a route handler: rate limit → CSRF (unsafe methods) → handler →
 * typed error mapping. Keeps every route's cross-cutting concerns identical.
 */
export function handle<TParams extends Record<string, string | string[]> = Record<string, string>>(
  fn: (req: NextRequest, ctx?: RouteContext<TParams>) => Promise<NextResponse>,
  opts: HandleOptions = {},
) {
  return async (req: NextRequest, ctx?: RouteContext<TParams>): Promise<NextResponse> => {
    try {
      // 1. Rate limiting (env-overridable; disabled in tests via RATE_LIMIT_DISABLED=1).
      const preset = opts.rateLimit === undefined ? inferRateLimitPreset(req) : opts.rateLimit;
      if (preset) {
        const { limit, windowMs } = RATE_LIMITS[preset];
        const result = checkRateLimit({
          key: `${preset}:${getClientIp(req)}`,
          limit,
          windowMs,
        });
        if (!result.allowed) throw new RateLimitedError(result.retryAfterMs);
      }
      // 2. CSRF for cookie-authed mutations (double-submit, see lib/auth/csrf).
      if (opts.csrf !== false && UNSAFE_METHODS.has(req.method)) {
        assertCsrf(req);
      }
      // 3. Business logic.
      return await fn(req, ctx);
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

/** Parse + validate a JSON body with a zod schema, or throw 400. */
export async function parseJson<T>(
  req: NextRequest,
  schema: { parse: (data: unknown) => T },
): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }
  return schema.parse(body);
}
