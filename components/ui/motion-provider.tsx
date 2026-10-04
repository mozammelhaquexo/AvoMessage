"use client";

/**
 * MotionProvider — wraps the app in framer-motion's MotionConfig with
 * `reducedMotion="user"` so ALL JS-driven motion (springs, AnimatePresence
 * exits, layout animations) automatically degrades to instant transitions
 * when the OS requests reduced motion. (CSS animations/transitions are
 * handled by the global `prefers-reduced-motion` rule in globals.css.)
 */

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
