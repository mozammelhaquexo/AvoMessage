/**
 * app/loading.tsx — root loading UI.
 *
 * Rendered as the instant fallback for any route segment that doesn't define
 * its own loading.tsx, so navigations never flash a blank page while the
 * server component tree streams in.
 */
export default function RootLoading() {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-4"
      role="status"
      aria-label="Loading"
    >
      <span
        aria-hidden
        className="h-10 w-10 animate-spin rounded-full border-[3px] border-line-strong border-t-brand"
      />
      <p className="text-body-sm text-ink-2">Loading…</p>
    </div>
  );
}
