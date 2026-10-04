/**
 * app/not-found.tsx — branded 404 (pure Server Component; no client
 * component imports so it never trips the server/client boundary).
 */
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <span
          aria-hidden
          className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-soft text-brand-strong"
        >
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </span>
        <h1 className="font-display text-h1 font-bold tracking-tight text-ink">Page not found</h1>
        <p className="text-body-sm text-ink-2">
          The page you&apos;re looking for doesn&apos;t exist or was moved.
        </p>
        <div className="mt-2 flex gap-2">
          <Link
            href="/home"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-brand-cta px-5 text-body-sm font-semibold text-on-brand shadow-pop transition-all duration-fast hover:brightness-105 active:scale-[0.98]"
          >
            Go home
          </Link>
          <Link
            href="/world"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line-strong px-5 text-body-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            Explore World
          </Link>
        </div>
      </div>
    </div>
  );
}
