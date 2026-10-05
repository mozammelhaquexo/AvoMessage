/**
 * components/manage/ManagerLanding.tsx — what `/manage` shows when the viewer
 * has no company console to open.
 *
 * WHY THIS EXISTS
 * `/manage` had no index route at all. The sidebar's Manager Panel link points
 * at `/manage/<slug>`, so the moment an approved manager had no company yet —
 * which is the normal state right after approval, because a manager creates
 * their own company — there was nothing to link to, and following the link by
 * hand gave a 404. Mozammel bhai described exactly that: "manager page e kichui
 * show hoy na".
 *
 * So this page is the missing half of the flow. Three states, three honest
 * answers, and never a dead end:
 *
 *   approved  an administrator said yes; the next step is yours — create the
 *             company (or open the one you already manage).
 *   pending   the application is in; there is nothing to do but wait, and the
 *             copy says so rather than showing an empty console.
 *   none      no approval on record; the way in is the application form.
 *
 * The Bengali is deliberate — this is the applicant-facing half of the feature
 * and the audience reads Bengali, matching `NoCompanyYet` and the
 * company-creation refusal on `/companies/new`.
 */
"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Button, Icon, type IconName } from "@/components/ui";
import { fadeUp, staggerList } from "@/lib/motion";

export type ManagerLandingState = "approved" | "pending" | "none";

interface Copy {
  icon: IconName;
  title: string;
  body: string;
  footnote: string;
  english: string;
}

const COPY: Record<ManagerLandingState, Copy> = {
  approved: {
    icon: "building",
    title: "আপনি ম্যানেজার হিসেবে অনুমোদিত হয়েছেন",
    body:
      "ম্যানেজার প্যানেল খুলতে হলে আপনার নিজের কোম্পানি তৈরি করতে হবে — এর জন্য কোনো ম্যানেজারের অনুমতি লাগবে না।",
    footnote:
      "কোম্পানি তৈরি হওয়ার সাথে সাথেই আপনার সাইডবারে Manager Panel চালু হয়ে যাবে।",
    english: "Approved as a manager · create your company to open the panel",
  },
  pending: {
    icon: "clock",
    title: "আপনার আবেদন পর্যালোচনাধীন আছে",
    body:
      "ম্যানেজার পদের জন্য আপনার আবেদনটি অ্যাডমিনের কাছে আছে। তিনি অনুমোদন করলে সাথে সাথে আপনার সাইডবারে Manager Panel দেখা যাবে।",
    footnote: "অনুগ্রহ করে অপেক্ষা করুন — অনুমোদনের জন্য কোনো ম্যানেজারের কাছে যেতে হবে না।",
    english: "Application under review · an administrator decides by hand",
  },
  none: {
    icon: "shield",
    title: "ম্যানেজার প্যানেল শুধু অনুমোদিত ম্যানেজারের জন্য",
    body:
      "ম্যানেজার প্যানেল ব্যবহার করতে হলে আগে ম্যানেজার পদের জন্য আবেদন করতে হবে। অ্যাডমিন আবেদনটি হাতে দেখে অনুমোদন দেন।",
    footnote: "অনুমোদিত হওয়ার পর আপনি নিজেই আপনার কোম্পানি তৈরি করতে পারবেন।",
    english: "No manager approval on this account yet",
  },
};

export function ManagerLanding({ state }: { state: ManagerLandingState }) {
  const reduce = useReducedMotion() ?? false;
  const copy = COPY[state];

  const breathe = reduce
    ? undefined
    : { duration: 3.2, repeat: Infinity, ease: "easeOut" as const };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <motion.section
        variants={fadeUp}
        initial="hidden"
        animate="show"
        aria-labelledby="manager-landing-title"
        className="relative overflow-hidden rounded-xl border border-line bg-surface px-6 py-9 sm:px-8 sm:py-11"
      >
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
            {!reduce &&
              [0, 1].map((i) => (
                <motion.span
                  key={i}
                  aria-hidden
                  className="absolute h-14 w-14 rounded-full border border-brand/40"
                  initial={{ scale: 1, opacity: 0.5 }}
                  animate={{ scale: 2.1, opacity: 0 }}
                  transition={{ ...breathe, delay: i * 1.6 }}
                />
              ))}
            <motion.span
              className="grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-brand-strong"
              animate={reduce ? undefined : { y: [0, -5, 0] }}
              transition={
                reduce ? undefined : { duration: 3.6, repeat: Infinity, ease: "easeInOut" }
              }
            >
              <Icon name={copy.icon} size={26} aria-hidden />
            </motion.span>
          </span>

          <motion.div variants={staggerList} initial="hidden" animate="show" className="mt-5">
            <motion.h1
              id="manager-landing-title"
              variants={fadeUp}
              className="font-display text-h2 font-bold text-ink"
            >
              {copy.title}
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="mx-auto mt-2 max-w-[48ch] text-body-sm leading-relaxed text-ink-2"
            >
              {copy.body}
            </motion.p>

            <motion.p
              variants={fadeUp}
              className="mx-auto mt-1.5 max-w-[48ch] text-body-sm leading-relaxed text-ink-3"
            >
              {copy.footnote}
            </motion.p>

            <motion.div
              variants={fadeUp}
              className="mt-6 flex flex-wrap justify-center gap-2"
            >
              {state === "approved" && (
                <>
                  <Button href="/companies/new">
                    <Icon name="building" size={16} aria-hidden className="mr-1.5" />
                    কোম্পানি তৈরি করুন
                  </Button>
                  <Button href="/companies" variant="outline">
                    Companies দেখুন
                  </Button>
                </>
              )}
              {state === "pending" && (
                <Button href="/settings?tab=manager" variant="outline">
                  আবেদনের অবস্থা দেখুন
                </Button>
              )}
              {state === "none" && (
                <>
                  <Button href="/settings/manager/apply">
                    <Icon name="send" size={16} aria-hidden className="mr-1.5" />
                    আবেদন করুন
                  </Button>
                  <Button href="/home" variant="outline">
                    হোমে ফিরে যান
                  </Button>
                </>
              )}
            </motion.div>

            <motion.p variants={fadeUp} className="mt-4 text-caption text-ink-3" lang="en">
              {copy.english}
            </motion.p>
          </motion.div>
        </div>
      </motion.section>
    </div>
  );
}
