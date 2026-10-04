/**
 * lib/api-client.ts — typed browser fetch client for the AvoMessage REST API.
 *
 * Owned by Frontend Engineer A.
 *
 * Conventions:
 * - Same-origin fetch with `credentials: "include"` (httpOnly session cookie).
 * - CSRF: unsafe methods send `x-csrf-token` from the readable `avo_csrf`
 *   cookie (double-submit scheme, see lib/auth/csrf.ts server-side).
 *   The names are duplicated as literals here because lib/auth/csrf.ts
 *   imports `node:crypto` and is not client-bundle safe.
 * - Success → parsed JSON body. Failure → throws `ApiError` carrying the
 *   `{ error: { code, message, fields? } }` envelope (ARCHITECTURE.md §1).
 *   Network failures surface as `ApiError` with code `NETWORK_ERROR`.
 */
"use client";

import type { Page, UploadedFile } from "./api-types";

/** Must match CSRF_COOKIE_NAME / CSRF_HEADER_NAME in lib/auth/csrf.ts. */
const CSRF_COOKIE_NAME = "avo_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields?: Record<string, string[]>;

  constructor(code: string, message: string, status: number, fields?: Record<string, string[]>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.fields = fields;
  }

  /** True for unauthenticated / suspended sessions — route to login/logout. */
  get isAuthError(): boolean {
    return this.status === 401 || this.code === "ACCOUNT_SUSPENDED";
  }
}

/** Read the double-submit CSRF cookie (non-HttpOnly by design). */
export function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${CSRF_COOKIE_NAME}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      const value = decodeURIComponent(trimmed.slice(prefix.length));
      return value || null;
    }
  }
  return null;
}

export type QueryValue = string | number | boolean | null | undefined;

/** Append defined query params to a path. */
export function withQuery(path: string, params?: Record<string, QueryValue>): string {
  if (!params) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const str = qs.toString();
  return str ? `${path}${path.includes("?") ? "&" : "?"}${str}` : path;
}

const UNSAFE = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Override query params, appended to the path. */
  params?: Record<string, string | number | boolean | undefined | null>;
}

/**
 * Core request. Throws ApiError on non-2xx or network failure.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { body, params, headers, ...rest } = options;

  const url = withQuery(path, params);
  const method = (rest.method ?? (body !== undefined ? "POST" : "GET")).toUpperCase();
  const isUnsafe = UNSAFE.has(method);

  const reqHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(headers as Record<string, string> | undefined),
  };
  if (body !== undefined && !(body instanceof FormData)) {
    reqHeaders["Content-Type"] = "application/json";
  }
  if (isUnsafe) {
    const csrf = getCsrfToken();
    // Pre-auth routes (login/signup/…) are exempt server-side; the header is
    // simply absent until the first session is issued.
    if (csrf) reqHeaders[CSRF_HEADER_NAME] = csrf;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      method,
      headers: reqHeaders,
      credentials: "include",
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      "NETWORK_ERROR",
      "Could not reach AvoMessage. Check your connection and try again.",
      0,
    );
  }

  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await res.json().catch(() => null)
    : null;

  if (!res.ok) {
    const err = payload?.error;
    throw new ApiError(
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? `Request failed (${res.status})`,
      res.status,
      err?.fields,
    );
  }
  return payload as T;
}

export const apiGet = <T>(path: string, options?: ApiFetchOptions) =>
  apiFetch<T>(path, { ...options, method: "GET" });
export const apiPost = <T>(path: string, body?: unknown, options?: ApiFetchOptions) =>
  apiFetch<T>(path, { ...options, method: "POST", body });
export const apiPatch = <T>(path: string, body?: unknown, options?: ApiFetchOptions) =>
  apiFetch<T>(path, { ...options, method: "PATCH", body });
export const apiPut = <T>(path: string, body?: unknown, options?: ApiFetchOptions) =>
  apiFetch<T>(path, { ...options, method: "PUT", body });
export const apiDelete = <T>(path: string, body?: unknown, options?: ApiFetchOptions) =>
  apiFetch<T>(path, { ...options, method: "DELETE", body });

/** Multipart POST (generic). */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: form });
}

/**
 * Upload a file to POST /api/uploads with an upload kind
 * (`avatar` | `cover` | `post` | `message` | `voice` | `company-logo`).
 * Requires a verified email (enforced server-side).
 */
export async function uploadFile(kind: string, file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", file, file.name);
  return apiUpload<UploadedFile>("/api/uploads", form);
}

/** Convenience: true when the error is an auth/authorization failure. */
export function isAuthError(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 401 || e.status === 403);
}

/**
 * Object-style API — `api.get<T>(…)` / `api.post<T>(…)` / `api.patch<T>(…)` /
 * `api.del<T>(…)` plus `api.uploadFile(kind, file)`.
 */
export const api = {
  get: apiGet,
  post: apiPost,
  put: apiPut,
  patch: apiPatch,
  del: apiDelete,
  uploadFile,
};

/**
 * Request alias used by older call sites; identical to apiFetch.
 */
export const request = apiFetch;

/** Fetch every page of a cursor-paginated endpoint (bounded). */
export async function fetchAllPages<T>(
  loadPage: (cursor: string | null) => Promise<Page<T>>,
  maxPages = 10,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page = await loadPage(cursor);
    out.push(...page.data);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}
