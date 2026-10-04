/**
 * app/(app)/loading.tsx — content-area fallback for authenticated routes.
 *
 * Measured, not assumed. `scripts/verify-chat-click-in-browser.mjs` drives a
 * real Chrome over CDP, clicks a link, and reads the live DOM back. Holding the
 * RSC response for 800 ms to force the slow path:
 *
 *   with this file      → route commits immediately, this skeleton renders in
 *                         the content area, the <aside> shell node is never
 *                         replaced, 0 whole-window spinners
 *   without this file   → no skeleton at all; the URL only commits after the
 *                         payload lands (~970 ms), so the app looks frozen on
 *                         the old page for about a second
 *
 * That is the real value here: immediate feedback and an immediate route
 * change, instead of a second of nothing.
 *
 * It is NOT true that the root `app/loading.tsx` was hijacking these
 * navigations. It cannot: `app/(app)/layout.tsx` awaits `getServerSession()`,
 * which reads cookies — uncached runtime data — and per the `loading.js`
 * reference, "if the layout accesses uncached or runtime data, loading.js will
 * not show a fallback for it". Measured behaviour agrees: the whole-window
 * spinner never appeared during a client-side navigation, with or without this
 * file. It is still worth keeping this boundary scoped to the content area, so
 * that if the layout ever becomes cacheable, the fallback that fires is the
 * one that leaves the sidebar alone.
 *
 * Deliberately generic — a heading block and a few cards — because it stands in
 * for every page under `(app)`. A page-specific skeleton (like the profile's)
 * still takes over as soon as that page's own code is available.
 */
export default function AppGroupLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl" role="status" aria-busy aria-label="Loading page">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="skeleton-shimmer h-11 w-11 rounded-full" aria-hidden />
          <div className="flex flex-1 flex-col gap-2">
            <div className="skeleton-shimmer h-4 w-40 rounded-sm" aria-hidden />
            <div className="skeleton-shimmer h-3 w-24 rounded-sm" aria-hidden />
          </div>
        </div>

        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
          >
            <div className="skeleton-shimmer h-4 w-1/3 rounded-sm" aria-hidden />
            <div className="skeleton-shimmer h-3 w-full rounded-sm" aria-hidden />
            <div className="skeleton-shimmer h-3 w-5/6 rounded-sm" aria-hidden />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
