/**
 * lib/route.ts — tiny helpers for App Router route handlers (Backend Engineer B).
 */
import type { RouteContext } from "@/lib/api";

/**
 * Await Next.js 16 async `params`. Catch-all segments arrive as string[];
 * this helper normalizes to single strings (all B-domain routes use
 * single-segment params, so an array here would be a routing bug — the
 * first segment is taken).
 */
export async function routeParams(ctx?: RouteContext): Promise<Record<string, string>> {
  const raw = (await ctx?.params) ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = Array.isArray(v) ? (v[0] ?? "") : v;
  }
  return out;
}

/** Read a single query param. */
export function queryParam(req: Request, name: string): string | null {
  return new URL(req.url).searchParams.get(name);
}
