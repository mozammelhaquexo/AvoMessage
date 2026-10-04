/**
 * app/(public)/_components/auth-shell.tsx — split auth layout.
 * Left: contextual brand panel (premium visuals, feature bullets).
 * Right: the active form. Mobile: brand strip on top.
 */
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Icon, type IconName } from "@/components/ui";
import { fadeUp } from "@/lib/motion";

const HIGHLIGHTS: { icon: IconName; title: string; body: string }[] = [
  { icon: "message", title: "Real-time messaging", body: "1:1, group, and company chats with typing indicators and read receipts." },
  { icon: "globe", title: "World feed", body: "Share posts, photos, and ideas with your community." },
  { icon: "building", title: "Company workspaces", body: "Private feeds, teams, and announcements for your org." },
  { icon: "shield", title: "Private by design", body: "Company posts stay inside the company. Always." },
];

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh bg-canvas">
      {/* Brand panel — `bg-brand-hero` keeps every gradient stop dark enough
          that the white text below clears WCAG AA in both themes. */}
      <div className="relative hidden w-[42%] shrink-0 overflow-hidden bg-brand-hero lg:block" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.25),transparent_50%),radial-gradient(circle_at_80%_90%,rgba(0,0,0,0.18),transparent_45%)]" />
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="relative flex h-full flex-col justify-between p-10 text-white"
        >
          <Link href="/" className="flex items-center gap-2.5" aria-label="AvoMessage home">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
                <path d="M12 2C7 2 3 6.5 3 12c0 2.4.9 4.6 2.3 6.3L3 21l2.8-2.1c1.3.7 2.7 1.1 4.2 1.1h2c5 0 9-4.5 9-10S17 2 12 2Z" />
              </svg>
            </span>
            <span className="font-display text-h2 font-bold tracking-tight">AvoMessage</span>
          </Link>
          <div className="flex flex-col gap-5">
            <h2 className="font-display text-h1 font-bold leading-tight">
              Chat, share, and work together — in one place.
            </h2>
            <ul className="flex flex-col gap-4">
              {HIGHLIGHTS.map((h, i) => (
                <motion.li
                  key={h.title}
                  variants={fadeUp}
                  initial="hidden"
                  animate="show"
                  transition={{ delay: 0.1 + i * 0.08 }}
                  className="flex gap-3.5"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                    <Icon name={h.icon} size={19} />
                  </span>
                  <span>
                    <span className="block text-body-sm font-semibold">{h.title}</span>
                    <span className="block text-body-sm text-white/75">{h.body}</span>
                  </span>
                </motion.li>
              ))}
            </ul>
          </div>
          <p className="text-caption text-white/60">© 2026 AvoMessage · Secure, real-time, yours.</p>
        </motion.div>
      </div>

      {/* Form side */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile brand strip */}
        <div className="flex items-center justify-between px-5 py-4 lg:hidden">
          <Link href="/" className="flex items-center gap-2" aria-label="AvoMessage home">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-cta text-on-brand">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                <path d="M12 2C7 2 3 6.5 3 12c0 2.4.9 4.6 2.3 6.3L3 21l2.8-2.1c1.3.7 2.7 1.1 4.2 1.1h2c5 0 9-4.5 9-10S17 2 12 2Z" />
              </svg>
            </span>
            <span className="font-display text-lg font-bold tracking-tight">
              Avo<span className="text-brand-gradient">Message</span>
            </span>
          </Link>
        </div>

        <main className="flex flex-1 items-center justify-center px-5 py-10">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="show"
            className="w-full max-w-md"
          >
            <h1 className="font-display text-h1 font-bold tracking-tight text-ink">{title}</h1>
            {subtitle && <div className="mt-2 text-body-sm text-ink-2">{subtitle}</div>}
            <div className="mt-7">{children}</div>
            {footer && <div className="mt-6 text-center text-body-sm text-ink-2">{footer}</div>}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
