/**
 * app/(public)/page.tsx — AvoMessage landing page.
 * Hero, value props, animated product preview, CTAs, footer.
 */
"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Avatar, Button, Card, Icon, type IconName } from "@/components/ui";
import { fadeUp, springGentle } from "@/lib/motion";

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: "message", title: "Real-time messaging", body: "1:1 and group chats with typing indicators, delivery and read receipts, reactions, and voice messages." },
  { icon: "globe", title: "World feed", body: "Share posts, photos, and video with your community. Likes, comments, reposts, hashtags, and mentions included." },
  { icon: "building", title: "Company workspaces", body: "Private company feeds, teams, announcements, and member management — collaboration without the noise." },
  { icon: "phone", title: "Voice & audio calls", body: "Crystal-clear 1:1 and group audio calls with full call history, right from any conversation." },
  { icon: "shield", title: "Private by design", body: "Company-private posts are enforced server-side and never leak. Block, mute, and report tools keep you safe." },
  { icon: "bell", title: "Live notifications", body: "Instant alerts for messages, mentions, follows, and company updates — everywhere you are." },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      {/* Nav */}
      <header className="sticky top-0 z-sticky border-b border-line/60 bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <span className="flex items-center gap-2">
            <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-cta text-on-brand shadow-pop">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
                <path d="M12 2C7 2 3 6.5 3 12c0 2.4.9 4.6 2.3 6.3L3 21l2.8-2.1c1.3.7 2.7 1.1 4.2 1.1h2c5 0 9-4.5 9-10S17 2 12 2Z" />
              </svg>
            </span>
            <span className="font-display text-h3 font-bold tracking-tight">
              Avo<span className="text-brand-gradient">Message</span>
            </span>
          </span>
          <nav className="flex items-center gap-2" aria-label="Account">
            <Button href="/login" variant="ghost">Log in</Button>
            <Button href="/signup">Sign up free</Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 left-1/2 h-96 w-[60rem] -translate-x-1/2 rounded-full bg-brand-soft blur-3xl dark:bg-brand-soft/40" />
          <div className="absolute right-[10%] top-40 h-64 w-64 rounded-full bg-accent-soft blur-3xl" />
        </div>
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-2 lg:pt-20">
          <motion.div variants={fadeUp} initial="hidden" animate="show" className="flex flex-col items-start gap-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-caption font-semibold text-ink-2 shadow-sm">
              <span aria-hidden className="h-2 w-2 rounded-full bg-online" />
              Social · Messaging · Company collaboration
            </span>
            <h1 className="font-display text-display font-extrabold leading-[1.05] tracking-tight">
              Every conversation,
              <br />
              <span className="text-brand-gradient">beautifully in one place.</span>
            </h1>
            <p className="max-w-md text-lg leading-relaxed text-ink-2">
              AvoMessage blends your social world, your chats, and your company workspace —
              with real-time messaging, voice calls, and privacy you can trust.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button href="/signup" size="lg">Get started free</Button>
              <Button href="/login" size="lg" variant="outline">Log in</Button>
            </div>
            <p className="text-caption text-ink-3">Free to start · No credit card · Your data stays yours</p>
          </motion.div>

          {/* Animated product preview */}
          <motion.div
            initial={{ opacity: 0, y: 40, rotate: 1 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ ...springGentle, delay: 0.15 }}
            className="relative mx-auto w-full max-w-sm"
            aria-hidden
          >
            <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-lg">
              <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
              </div>
              <div className="flex flex-col gap-3 p-4">
                <PreviewPost name="Maya Chen" handle="@maya" text="Just shipped our new onboarding flow 🥑 The team crushed it this sprint!" likes={128} comments={24} delay={0.4} />
                <PreviewPost name="Dev Team" handle="@acme-dev" text="Reminder: design review at 3pm — bring your prototypes. #design" likes={46} comments={8} delay={0.6} />
                <div className="flex items-center gap-3 rounded-2xl bg-bubble-own p-3">
                  <Avatar name="Leo Park" size="sm" />
                  <div className="flex-1">
                    <div className="h-2.5 w-3/4 rounded bg-ink/15" />
                    <div className="mt-1.5 h-2.5 w-1/2 rounded bg-ink/10" />
                  </div>
                  <span className="flex gap-1" aria-hidden>
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-ink-3" />
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-ink-3" />
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-ink-3" />
                  </span>
                </div>
              </div>
            </div>
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -right-4 -top-6 rounded-2xl border border-line bg-surface p-3 shadow-pop"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success/15 text-success-strong">
                  <Icon name="phone" size={16} />
                </span>
                <div>
                  <p className="text-caption font-semibold">Voice call</p>
                  <p className="text-tiny text-ink-3">Connected · 04:32</p>
                </div>
              </div>
            </motion.div>
            <motion.div
              animate={{ y: [0, 10, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
              className="absolute -left-5 bottom-10 rounded-2xl border border-line bg-surface p-3 shadow-pop"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-brand-strong">
                  <Icon name="bell" size={16} />
                </span>
                <div>
                  <p className="text-caption font-semibold">Maya liked your post</p>
                  <p className="text-tiny text-ink-3">just now</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-line bg-surface/50" aria-labelledby="features-heading">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-80px" }} className="mx-auto max-w-2xl text-center">
            <h2 id="features-heading" className="font-display text-h1 font-bold tracking-tight">
              One app for your <span className="text-brand-gradient">whole social life</span>
            </h2>
            <p className="mt-3 text-body text-ink-2">
              Stop juggling five apps. AvoMessage brings your people, your chats, and your work together.
            </p>
          </motion.div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                variants={fadeUp}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, margin: "-60px" }}
                transition={{ delay: (i % 3) * 0.08 }}
              >
                <Card className="h-full p-5 transition-shadow duration-base hover:shadow-md">
                  <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand-strong">
                    <Icon name={f.icon} size={20} />
                  </span>
                  <h3 className="mt-3.5 text-h3 font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-body-sm leading-relaxed text-ink-2">{f.body}</p>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Privacy band */}
      <section className="border-t border-line" aria-labelledby="privacy-heading">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-16 sm:px-6 lg:grid-cols-2">
          <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-80px" }}>
            <h2 id="privacy-heading" className="font-display text-h1 font-bold tracking-tight">
              Privacy isn&apos;t a setting. <span className="text-brand-gradient">It&apos;s the architecture.</span>
            </h2>
            <ul className="mt-5 flex flex-col gap-3 text-body-sm text-ink-2">
              {[
                "Company-private posts are enforced server-side — never visible to outsiders, not even via the API.",
                "Secure sessions, CSRF protection, rate limiting, and audit trails throughout.",
                "Block, mute, and report tools with human moderation review.",
              ].map((line) => (
                <li key={line} className="flex gap-2.5">
                  <Icon name="check" size={18} className="mt-0.5 shrink-0 text-success-strong" aria-hidden />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </motion.div>
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
            className="rounded-3xl border border-line bg-brand-gradient-soft p-8"
          >
            <Icon name="lock" size={32} className="text-brand-strong" aria-hidden />
            <p className="mt-4 font-display text-h2 font-bold leading-snug">
              “Your company&apos;s conversations stay your company&apos;s.”
            </p>
            <p className="mt-3 text-body-sm text-ink-2">
              Role-based access control governs every action — platform, company, team, and content
              levels — all enforced on the server.
            </p>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-line bg-surface/50" aria-labelledby="cta-heading">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
          <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-80px" }}>
            <h2 id="cta-heading" className="font-display text-h1 font-bold tracking-tight">
              Ready to join the conversation?
            </h2>
            <p className="mx-auto mt-3 max-w-md text-body text-ink-2">
              Create your free account in under a minute and bring your people with you.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Button href="/signup" size="lg">Create free account</Button>
              <Button href="/login" size="lg" variant="outline">Log in</Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <span className="flex items-center gap-2">
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-cta text-on-brand">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
                <path d="M12 2C7 2 3 6.5 3 12c0 2.4.9 4.6 2.3 6.3L3 21l2.8-2.1c1.3.7 2.7 1.1 4.2 1.1h2c5 0 9-4.5 9-10S17 2 12 2Z" />
              </svg>
            </span>
            <span className="font-display font-bold">AvoMessage</span>
          </span>
          <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-body-sm text-ink-2" aria-label="Footer">
            <Link href="/login" className="hover:text-ink hover:underline">Log in</Link>
            <Link href="/signup" className="hover:text-ink hover:underline">Sign up</Link>
            <Link href="/help" className="hover:text-ink hover:underline">Help</Link>
          </nav>
          <p className="text-caption text-ink-3">© 2026 AvoMessage. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

function PreviewPost({ name, handle, text, likes, comments, delay }: { name: string; handle: string; text: string; likes: number; comments: number; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, ...springGentle }}
      className="rounded-2xl border border-line bg-canvas p-3"
    >
      <div className="flex items-center gap-2.5">
        <Avatar name={name} size="sm" />
        <div className="flex-1">
          <p className="text-caption font-semibold">{name}</p>
          <p className="text-tiny text-ink-3">{handle} · 2h</p>
        </div>
      </div>
      <p className="mt-2 text-body-sm">{text}</p>
      <div className="mt-2 flex gap-4 text-ink-3">
        <span className="flex items-center gap-1 text-caption"><Icon name="heart" size={14} />{likes}</span>
        <span className="flex items-center gap-1 text-caption"><Icon name="comment" size={14} />{comments}</span>
        <span className="flex items-center gap-1 text-caption"><Icon name="share" size={14} /></span>
      </div>
    </motion.div>
  );
}
