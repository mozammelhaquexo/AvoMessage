/**
 * components/ui/otp-input.tsx — the one-time-code field.
 *
 * Six single-character boxes rather than one text input, for three reasons that
 * are all about the person typing a code they are reading off another screen:
 * the length is obvious without a hint, a wrong digit can be corrected in place
 * instead of retyping six, and `autoComplete="one-time-code"` on the first box
 * lets iOS and Android offer the code straight from the SMS/notification.
 *
 * ── The value model ────────────────────────────────────────────────────────
 *
 * The field is controlled by a single left-aligned string. A gap in the middle
 * is therefore not representable: `"1"` in box 1 and `"5"` in box 4 join to
 * `"15"`, which renders as `1 5 _ _ _ _`. That is the standard behaviour for
 * this control and keeps the parent's only question — `value.length === 6` —
 * trivially answerable. Codes are typed left to right; clicking into the middle
 * of an empty field is the one case where a digit appears to jump, and it is
 * corrected by the same backspace the user was about to press anyway.
 */
"use client";

import {
  useEffect,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { cn } from "./utils";

export interface OtpInputProps {
  /** Assembled digits, left-aligned, at most `length` characters. */
  value: string;
  onChange: (value: string) => void;
  /** Fired the moment `value` reaches `length` — drives auto-submit. */
  onComplete?: (value: string) => void;
  length?: number;
  disabled?: boolean;
  invalid?: boolean;
  /** Focus the first box on mount. */
  autoFocus?: boolean;
  /** Accessible name for the group; each box is "Digit n of length". */
  label?: string;
  className?: string;
}

const NON_DIGIT = /\D/g;

export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled = false,
  invalid = false,
  autoFocus = false,
  label = "One-time code",
  className,
}: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  /** One cell per box; `value` may be shorter while the user is mid-entry. */
  const cells = Array.from({ length }, (_, i) => value[i] ?? "");

  useEffect(() => {
    if (!autoFocus) return;
    const el = refs.current[0];
    el?.focus();
    el?.select();
  }, [autoFocus]);

  function focusAt(index: number) {
    const el = refs.current[Math.min(length - 1, Math.max(0, index))];
    if (!el) return;
    el.focus();
    el.select();
  }

  /**
   * Publish a new value and auto-submit when it is complete.
   *
   * Firing `onComplete` from the change handler rather than from an effect on
   * `value` is what keeps this from re-submitting: a rejected code clears the
   * field, so the next completion is always a genuinely new attempt, and an
   * unchanged value never fires twice.
   */
  function commit(next: string[]) {
    const joined = next.join("").slice(0, length);
    onChange(joined);
    if (joined.length === length) onComplete?.(joined);
  }

  function handleChange(index: number, e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(NON_DIGIT, "");
    const next = cells.slice();

    if (raw.length === 0) {
      next[index] = "";
      commit(next);
      return;
    }

    // One digit, or several from an autofill / IME commit — either way they
    // land from `index` onward.
    for (let k = 0; k < raw.length && index + k < length; k++) next[index + k] = raw[k];
    commit(next);
    focusAt(index + raw.length);
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        focusAt(index - 1);
        return;
      case "ArrowRight":
        e.preventDefault();
        focusAt(index + 1);
        return;
      case "Home":
        e.preventDefault();
        focusAt(0);
        return;
      case "End":
        e.preventDefault();
        focusAt(length - 1);
        return;
      case "Backspace":
        // An empty box has nothing to delete, so backspace means "step back and
        // clear that one" — otherwise it would silently do nothing.
        if (!cells[index] && index > 0) {
          e.preventDefault();
          const next = cells.slice();
          next[index - 1] = "";
          commit(next);
          focusAt(index - 1);
        }
        return;
      default:
        return;
    }
  }

  function handlePaste(index: number, e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(NON_DIGIT, "");
    if (!text) return;
    e.preventDefault();
    const next = cells.slice();
    for (let k = 0; k < text.length && index + k < length; k++) next[index + k] = text[k];
    commit(next);
    focusAt(index + text.length);
  }

  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex items-center gap-1.5 sm:gap-2", className)}
    >
      {cells.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          // The platform's own "fill this code" affordance hangs off the first
          // box; the rest opt out so they are not offered autofill suggestions.
          autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${index + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={digit}
          onChange={(e) => handleChange(index, e)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={(e) => handlePaste(index, e)}
          onFocus={(e) => e.currentTarget.select()}
          className={cn(
            "h-12 min-w-0 flex-1 basis-0 rounded-lg border bg-surface-2 text-center",
            "text-h3 font-semibold tabular-nums text-ink caret-brand sm:h-14",
            "transition-colors duration-fast ease-out",
            "border-line hover:border-line-strong",
            "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30",
            "disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-60",
            "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/25",
          )}
        />
      ))}
    </div>
  );
}
