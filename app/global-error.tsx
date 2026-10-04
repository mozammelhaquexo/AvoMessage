"use client";

/**
 * app/global-error.tsx — last-resort boundary for errors thrown in the root
 * layout itself. Must render its own <html>/<body> (it replaces the root
 * layout when active) and cannot use the app's providers.
 */
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[avomessage] global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fafaf8",
          color: "#1a2013",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: 16,
        }}
      >
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px" }}>
            AvoMessage couldn&apos;t start this page
          </h1>
          <p style={{ fontSize: 14, color: "#4d5a3f", margin: "0 0 16px" }}>
            An unexpected error occurred. Please try again or reload the page.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              height: 44,
              padding: "0 20px",
              borderRadius: 8,
              border: "none",
              background: "#65a30d",
              color: "#17210c",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
