import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono, Sora } from "next/font/google";
import "./globals.css";
import { ThemeProvider, ThemeScript } from "@/lib/theme";
import { Toaster } from "@/components/ui/toaster";
import { MotionProvider } from "@/components/ui/motion-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display font for brand headlines / landing (DESIGN_TOKENS.md §3).
const sora = Sora({
  variable: "--font-avo-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: {
    default: "AvoMessage",
    template: "%s · AvoMessage",
  },
  description:
    "AvoMessage — social messaging and company collaboration. Chat, call, share, and work together in one place.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0f0a" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Per-request CSP nonce set by middleware (x-nonce request header).
  // Passed to the inline theme script so it satisfies script-src.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      // The theme class is applied pre-hydration by <ThemeScript />; suppress
      // the expected class-attribute mismatch warning.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${sora.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* No-FOUC theme init — runs before first paint. */}
        <ThemeScript nonce={nonce} />
        <ThemeProvider>
          <MotionProvider>
            {children}
            <Toaster />
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
