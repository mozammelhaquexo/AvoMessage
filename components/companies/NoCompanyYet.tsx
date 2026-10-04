/**
 * components/companies/NoCompanyYet.tsx — what a person sees before they belong
 * to a company.
 *
 * This is the one place in the product that tells somebody how to get in: a
 * user cannot create a company, and cannot add themselves to one. Their manager
 * does it. So the copy has to do real work — say plainly that nothing is wrong,
 * who to talk to, and what happens next. A generic "no results" state would
 * leave them hunting for a button that does not exist.
 *
 * The Bengali is deliberate (Mozammel bhai asked for it here specifically) and
 * an English line sits under it, matching the bilingual habit of the OTP email.
 *
 * ── Motion ────────────────────────────────────────────────────────────────
 *
 * Three things move, all decorative and all switched off under
 * `prefers-reduced-motion`:
 *
 *   • two rings breathe out from the icon, so the card reads as "waiting"
 *     rather than "broken";
 *   • the icon floats a few pixels, slowly;
 *   • the text rises in on mount, staggered.
 *
 * Nothing animates a layout property, so this cannot reflow the feed it sits
 * above.
 */
"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Icon } from "@/components/ui";
import { fadeUp, staggerList } from "@/lib/motion";

export interface NoCompanyYetProps {
  /** Tighter spacing and a smaller icon, for a card rather than a page slot. */
  compact?: boolean;
  className?: string;
}

export function NoCompanyYet({ compact = false, className }: NoCompanyYetProps) {
  const reduce = useReducedMotion() ?? false;

  // One transition object, reused, so the loops cannot drift apart.
  const breathe = reduce
    ? undefined
    : { duration: 3.2, repeat: Infinity, ease: "easeOut" as const };

  return (
    <motion.section
      variants={fadeUp}
      initial="hidden"
      animate="show"
      aria-labelledby="no-company-title"
      className={[
        "relative overflow-hidden rounded-xl border border-line bg-surface",
        compact ? "px-5 py-6" : "px-6 py-9 sm:px-8 sm:py-11",
        className ?? "",
      ].join(" ")}
    >
      {/* A soft brand wash from the top-right, so the card is not a grey box.
          `pointer-events-none` because it sits over nothing interactive — it is
          decoration and must never eat a click. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          background:
            "radial-gradient(120% 90% at 100% 0%, var(--brand-soft) 0%, transparent 58%)",
        }}
      />

      <div className="relative flex flex-col items-center text-center">
        <span className="relative grid place-items-center">
          {/* Two rings leaving the icon on a loop. */}
          {!reduce &&
            [0, 1].map((i) => (
              <motion.span
                key={i}
                aria-hidden
                className="absolute rounded-full border border-brand/40"
                style={{ width: 56, height: 56 }}
                initial={{ scale: 1, opacity: 0.5 }}
                animate={{ scale: 2.1, opacity: 0 }}
                transition={{ ...breathe, delay: i * 1.6 }}
              />
            ))}

          <motion.span
            className={[
              "grid place-items-center rounded-full bg-brand-soft text-brand-strong",
              compact ? "h-12 w-12" : "h-14 w-14",
            ].join(" ")}
            animate={reduce ? undefined : { y: [0, -5, 0] }}
            transition={reduce ? undefined : { duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <Icon name="building" size={compact ? 22 : 26} aria-hidden />
          </motion.span>
        </span>

        <motion.div
          variants={staggerList}
          initial="hidden"
          animate="show"
          className={compact ? "mt-4" : "mt-5"}
        >
          <motion.h2
            id="no-company-title"
            variants={fadeUp}
            className={[
              "font-semibold text-ink",
              compact ? "text-body" : "text-h3",
            ].join(" ")}
          >
            আপনাকে এখনো কোনো কোম্পানিতে যোগ করা হয়নি
          </motion.h2>

          <motion.p
            variants={fadeUp}
            className="mx-auto mt-2 max-w-[46ch] text-body-sm leading-relaxed text-ink-2"
          >
            আপনার ম্যানেজারের সাথে যোগাযোগ করুন — তিনি আপনাকে কোম্পানিতে যোগ করে দেবেন।
          </motion.p>

          <motion.p
            variants={fadeUp}
            className="mx-auto mt-1.5 max-w-[46ch] text-body-sm leading-relaxed text-ink-3"
          >
            যোগ হওয়ার পর এখানেই কোম্পানির সব কিছু — পোস্ট, টিম আর আপডেট — দেখতে পাবেন।
          </motion.p>

          <motion.p
            variants={fadeUp}
            className="mt-4 text-caption text-ink-3"
            lang="en"
          >
            Not in a company yet · ask your manager to add you
          </motion.p>
        </motion.div>
      </div>
    </motion.section>
  );
}
