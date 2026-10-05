import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names with conflict resolution.
 * The single styling entry-point for all AvoMessage UI components —
 * always compose classes through `cn`, never by string concatenation.
 *
 * ── Why this is not a bare `twMerge` ────────────────────────────────────────
 *
 * tailwind-merge only knows Tailwind's *built-in* scale. This project declares
 * its own type scale in `app/globals.css` (`@theme`): display, h1, h2, h3,
 * body-sm, caption, tiny. An unknown `text-<something>` token is classified as
 * a text *colour*, so merging a size with a colour silently deleted the size:
 *
 *     twMerge("text-tiny", "text-amber-700")   // => "text-amber-700"
 *     twMerge("text-body-sm", "text-ink")      // => "text-ink"
 *
 * Nothing warned. The class simply vanished from the DOM, no rule set a
 * font-size, and the element fell back to the browser default 16px. Measured
 * on the live site: the "Super Admin" chip rendered at 16px next to a 14px
 * author name — the badge was larger than the name it labelled.
 *
 * A scan of the codebase found 37 `cn()` calls across 25 files losing a size
 * this way. Registering the tokens below fixes all of them at once, which is
 * why the fix belongs here and not at any individual call site.
 *
 * `extend` (not `override`) keeps Tailwind's built-ins — `text-sm`, `text-lg`
 * and `text-[13px]` still merge normally. Verified against tailwind-merge
 * v3.7.0, including that `text-tiny + text-caption` still resolves to the last
 * one, i.e. genuine size conflicts are unaffected.
 *
 * KEEP IN STEP with the `--text-*` entries in app/globals.css. Adding a token
 * there without adding it here reintroduces exactly this bug.
 */
const TYPE_SCALE = ["display", "h1", "h2", "h3", "body-sm", "caption", "tiny"] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...TYPE_SCALE] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(...inputs));
}
