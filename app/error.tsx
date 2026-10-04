"use client";

/**
 * app/error.tsx — root segment error boundary.
 *
 * Catches render errors for any route without its own error.tsx and shows a
 * branded fallback with a retry button. Errors are reported to the console;
 * hook up an error-tracking service here (Sentry etc.) when one is adopted.
 */
import { useEffect } from "react";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[avomessage] route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <span
          aria-hidden
          className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-2 text-danger-strong"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-8 w-8"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </span>
        <h1 className="font-display text-h1 font-bold tracking-tight text-ink">
          Something went wrong
        </h1>
        <p className="text-body-sm text-ink-2">
          This page hit an unexpected error. Try again — if it keeps happening,
          let us know.
        </p>
        {error.digest ? (
          <p className="text-body-sm text-ink-3">Error ref: {error.digest}</p>
        ) : null}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-brand-cta px-5 text-body-sm font-semibold text-on-brand shadow-pop transition-all duration-fast hover:brightness-105 active:scale-[0.98]"
          >
            Try again
          </button>
          <a
            href="/home"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line-strong px-5 text-body-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}
