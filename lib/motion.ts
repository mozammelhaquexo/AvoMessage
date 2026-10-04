/**
 * AvoMessage motion presets — intentional, premium, spring-based.
 *
 * Built on framer-motion. All presets respect `prefers-reduced-motion`
 * when used through `MotionConfig reducedMotion="user"` (wrap the app in
 * `components/ui/motion-config.tsx` or set it on individual trees) and
 * via the `useAvoReducedMotion` helper below.
 *
 * Guidance (per SPEC):
 * - Entrances: expressive & snappy → `easeOutExpo`-ish springs.
 * - Exits: quicker, calmer.
 * - Never animate layout-triggering properties on feed rows.
 * - Typing indicator / recording pulse use token durations (see globals.css).
 */

import { useReducedMotion, type Transition, type Variants } from "framer-motion";

/* ------------------------------------------------------------------ */
/* Spring presets                                                      */
/* ------------------------------------------------------------------ */

/** Snappy entrance spring — modals, toasts, menus. */
export const springSnappy: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 32,
  mass: 0.9,
};

/** Gentle spring — drawers, page transitions, large panels. */
export const springGentle: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 30,
  mass: 1,
};

/** Bouncy spring — reactions, likes, playful micro-interactions. */
export const springBouncy: Transition = {
  type: "spring",
  stiffness: 500,
  damping: 18,
  mass: 0.8,
};

/** Token-aligned tween transitions (durations from globals.css tokens). */
export const tweenInstant: Transition = { duration: 0.08, ease: [0.16, 1, 0.3, 1] };
export const tweenFast: Transition = { duration: 0.15, ease: [0.16, 1, 0.3, 1] };
export const tweenBase: Transition = { duration: 0.25, ease: [0.16, 1, 0.3, 1] };
export const tweenSlow: Transition = { duration: 0.4, ease: [0.65, 0, 0.35, 1] };

/** Shared easing curves (mirror of --ease-out / --ease-in-out tokens). */
export const easeOutExpo: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const easeInOut: [number, number, number, number] = [0.65, 0, 0.35, 1];

/* ------------------------------------------------------------------ */
/* Reusable variants                                                   */
/* ------------------------------------------------------------------ */

/** Fade + rise entrance — cards, list items, page sections. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: springSnappy },
  exit: { opacity: 0, y: 8, transition: tweenFast },
};

/** Plain fade — overlays, backdrops. */
export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: tweenBase },
  exit: { opacity: 0, transition: tweenFast },
};

/** Scale-in — dialogs, popovers, emoji pickers. */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 8 },
  show: { opacity: 1, scale: 1, y: 0, transition: springSnappy },
  exit: { opacity: 0, scale: 0.97, transition: tweenFast },
};

/** Slide-up sheet — mobile drawers, bottom sheets. */
export const slideUpSheet: Variants = {
  hidden: { y: "100%" },
  show: { y: 0, transition: springGentle },
  exit: { y: "100%", transition: tweenBase },
};

/** Slide-in from the right — desktop drawers, side panels. */
export const slideInRight: Variants = {
  hidden: { x: "100%" },
  show: { x: 0, transition: springGentle },
  exit: { x: "100%", transition: tweenBase },
};

/** Toast entrance — bottom stack. */
export const toastIn: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.95 },
  show: { opacity: 1, y: 0, scale: 1, transition: springSnappy },
  exit: { opacity: 0, y: 12, scale: 0.97, transition: tweenFast },
};

/** Stagger container for lists — children should use `fadeUp`-like variants. */
export const staggerList: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
  exit: {},
};

/** Pop — like button, reaction burst. */
export const pop: Variants = {
  idle: { scale: 1 },
  tap: { scale: 0.82, transition: tweenInstant },
  burst: { scale: [1, 1.35, 1], transition: { duration: 0.35, ease: easeOutExpo } },
};

/* ------------------------------------------------------------------ */
/* Reduced motion                                                      */
/* ------------------------------------------------------------------ */

/**
 * Returns true when the user prefers reduced motion. Use to skip
 * decorative animation in JS-driven motion (CSS is already handled by
 * the global `prefers-reduced-motion` rule in globals.css).
 */
export function useAvoReducedMotion(): boolean {
  return useReducedMotion() ?? false;
}

/**
 * Given a framer-motion transition, returns an instant (no-op) transition
 * when reduced motion is preferred.
 */
export function withReducedMotion(
  transition: Transition,
  reduce: boolean,
): Transition {
  return reduce ? { duration: 0 } : transition;
}
