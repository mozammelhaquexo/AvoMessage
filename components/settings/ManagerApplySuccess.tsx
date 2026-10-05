/**
 * components/settings/ManagerApplySuccess.tsx — the confirmation a person sees
 * the instant their manager application is accepted by the server.
 *
 * Mozammel bhai asked for this specifically: "apply er por sundor animation hoye
 * middle e banglay lekha thakbe je manager pod er jonno apply kore hoyeche,
 * admin approve korbe opekkha koruk" — a nice animation, centred, in Bengali,
 * saying the application is in and an administrator will decide.
 *
 * It replaces the old behaviour, which was a toast in the corner and an
 * immediate `router.push`. A toast is gone in four seconds and the redirect
 * happens whether or not it was read, so the one moment that has to be
 * unmistakable was the least visible thing on screen.
 *
 * ── Motion ────────────────────────────────────────────────────────────────
 * Four things move, all decorative, all disabled under
 * `prefers-reduced-motion` (framer-motion's `MotionConfig reducedMotion="user"`
 * is mounted app-wide, and `useReducedMotion` gates the loops that MotionConfig
 * does not cover):
 *
 *   • the backdrop fades in;
 *   • the panel scales up on a snappy spring;
 *   • three rings pulse out of the tick, so the moment reads as "sent";
 *   • the tick strokes itself on, then the text rises in, staggered.
 *
 * ── Why it auto-advances ─────────────────────────────────────────────────
 * The overlay dismisses itself after `AUTO_DISMISS_MS` and then calls
 * `onDone()`, which navigates. The button is there for anyone who wants to
 * leave sooner, and `role="status"` + `aria-live` means a screen reader hears
 * the message even if the overlay is gone by the time it is read out.
 */
"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button, Icon, useScrollLock } from "@/components/ui";
import { fade, scaleIn, fadeUp, staggerList, springSnappy } from "@/lib/motion";

/** How long the panel stays up before it navigates on its own. */
export const AUTO_DISMISS_MS = 6500;

export interface ManagerApplySuccessProps {
  open: boolean;
  /** Called once the overlay is finished — navigate from here. */
  onDone: () => void;
}

export function ManagerApplySuccess({ open, onDone }: ManagerApplySuccessProps) {
  const reduce = useReducedMotion() ?? false;
  /**
   * `visible` is the real switch. `open` says "the submission succeeded"; the
   * exit animation then plays against `visible` so the panel is still mounted
   * while it fades, and `onExitComplete` is what finally navigates. Dropping
   * straight to `open = false` would unmount the panel with no exit at all.
   */
  const [visible, setVisible] = useState(open);

  useScrollLock(visible);

  useEffect(() => {
    if (open) {
      setVisible(true);
      return;
    }
    setVisible(false);
  }, [open]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  const rings = reduce ? [] : [0, 1, 2];

  return (
    <AnimatePresence onExitComplete={onDone}>
      {visible && (
        <motion.div
          key="manager-apply-success"
          variants={fade}
          initial="hidden"
          animate="show"
          exit="exit"
          className="fixed inset-0 z-modal flex items-center justify-center p-4"
          role="status"
          aria-live="polite"
          aria-label="Manager application submitted"
        >
          {/* Backdrop. Solid enough to own the screen, translucent enough that
              the page is still recognisably behind it. */}
          <div aria-hidden className="absolute inset-0 bg-canvas/80 backdrop-blur-sm" />

          <motion.div
            variants={scaleIn}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface p-7 text-center shadow-pop"
          >
            {/* Brand wash, matching the "no company yet" card. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{
                background:
                  "radial-gradient(120% 90% at 50% 0%, var(--brand-soft) 0%, transparent 62%)",
              }}
            />

            <div className="relative flex flex-col items-center">
              {/* Rings + tick */}
              <span className="relative grid h-20 w-20 place-items-center">
                {rings.map((i) => (
                  <motion.span
                    key={i}
                    aria-hidden
                    className="absolute h-16 w-16 rounded-full border border-brand/40"
                    initial={{ scale: 1, opacity: 0.55 }}
                    animate={{ scale: 2.3, opacity: 0 }}
                    transition={{
                      duration: 2.8,
                      repeat: Infinity,
                      ease: "easeOut",
                      delay: i * 0.9,
                    }}
                  />
                ))}

                <motion.span
                  className="grid h-16 w-16 place-items-center rounded-full bg-brand-soft text-brand-strong"
                  initial={reduce ? false : { scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={springSnappy}
                >
                  <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden>
                    <motion.path
                      d="M5 12.8l4.2 4.2L19 7.2"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={reduce ? false : { pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.5, delay: 0.18, ease: "easeOut" }}
                    />
                  </svg>
                </motion.span>
              </span>

              <motion.div
                variants={staggerList}
                initial="hidden"
                animate="show"
                className="mt-5"
              >
                <motion.h2
                  variants={fadeUp}
                  className="font-display text-h2 font-bold text-ink"
                >
                  আবেদন জমা হয়েছে
                </motion.h2>

                <motion.p
                  variants={fadeUp}
                  className="mx-auto mt-2 max-w-[42ch] text-body-sm leading-relaxed text-ink-2"
                >
                  ম্যানেজার পদের জন্য আপনার আবেদনটি অ্যাডমিনের কাছে পাঠানো হয়েছে।
                </motion.p>

                <motion.p
                  variants={fadeUp}
                  className="mx-auto mt-1.5 max-w-[42ch] text-body-sm leading-relaxed text-ink-2"
                >
                  অ্যাডমিন অনুমোদন করলে সাথে সাথে আপনার সাইডবারে{" "}
                  <span className="font-semibold text-ink">Manager Panel</span> দেখতে পাবেন।
                  অনুগ্রহ করে অপেক্ষা করুন।
                </motion.p>

                {/* Indeterminate progress: the wait has no known length, and a
                    fake percentage would be a lie. */}
                <motion.div
                  variants={fadeUp}
                  aria-hidden
                  className="mx-auto mt-5 h-1 w-40 overflow-hidden rounded-full bg-surface-2"
                >
                  <motion.span
                    className="block h-full w-1/3 rounded-full bg-brand-cta"
                    animate={reduce ? { x: "100%" } : { x: ["-110%", "330%"] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                  />
                </motion.div>

                <motion.div variants={fadeUp} className="mt-6 flex justify-center">
                  <Button variant="outline" onClick={() => setVisible(false)}>
                    <Icon name="check" size={16} aria-hidden className="mr-1.5" />
                    ঠিক আছে
                  </Button>
                </motion.div>

                <motion.p variants={fadeUp} className="mt-3 text-caption text-ink-3" lang="en">
                  Application submitted · an administrator reviews it by hand
                </motion.p>
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
