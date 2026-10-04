import type { NextConfig } from "next";

// Security headers (see docs/SECURITY_REVIEW.md §6).
// HSTS is production-only: local dev typically serves plain HTTP, and
// sending HSTS there would pin the browser to HTTPS for localhost.
const isProd = process.env.NODE_ENV === "production";

const securityHeaders = [
  // Block MIME-sniffing: a served file is only ever interpreted as its
  // declared Content-Type (upload-serving defense in depth).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Never render AvoMessage inside a frame (clickjacking). CSP
  // frame-ancestors 'none' (set in middleware) is the modern equivalent;
  // this covers older browsers.
  { key: "X-Frame-Options", value: "DENY" },
  // Send origin-only referrers on cross-origin navigations.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Least-privilege device APIs: camera/microphone are allowed for our own
  // origin only (voice messages + audio/video calls use getUserMedia; the
  // page must explicitly request them). Everything else is denied outright.
  {
    key: "Permissions-Policy",
    value:
      "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  // Isolate our browsing context from cross-origin popups.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // Public uploads are served from /uploads/<key>, but the route handler lives
  // at app/api/uploads/[...path]/route.ts so it stays under the api/ tree and
  // reuses the same auth/CSP/middleware stack as other routes. Rewrite
  // /uploads/* → /api/uploads/* so URLs stored in the DB resolve correctly.
  async rewrites() {
    return [{ source: "/uploads/:path*", destination: "/api/uploads/:path*" }];
  },
  // The standalone Companies admin section was merged into Managers (request
  // 5). This is a routing-layer redirect on purpose: it answers with a real
  // 307 for every client, including curl and crawlers. A `redirect()` inside
  // the page component only produces a 200 carrying an RSC redirect payload,
  // because the custom server has already begun streaming the shell by then.
  async redirects() {
    return [
      {
        source: "/admin/companies",
        destination: "/admin/managers",
        permanent: false,
      },
    ];
  },
  // Compression: Next.js gzips responses by default (`compress: true`).
  // Behind a reverse proxy (nginx/Cloudflare), let the proxy own compression
  // and caching headers for static assets; the app server only compresses
  // dynamic responses. No `output: "standalone"` — AvoMessage ships a custom
  // server (server.ts: Next + Socket.io on one port), which `next start`
  // cannot serve; production boots with `npm start` (tsx) or the compiled
  // `dist-server` bundle instead.
  logging: {
    // Full request URLs in fetch logs are noisy and can carry tokens in
    // query strings; keep them short in production logs.
    fetches: { fullUrl: process.env.NODE_ENV !== "production" },
  },
  async headers() {
    return [
      {
        // Static headers for every route (pages, API, uploads). The
        // Content-Security-Policy itself is set per-request in
        // middleware.ts because it carries a fresh nonce.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
