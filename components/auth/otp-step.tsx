/**
 * components/auth/otp-step.tsx — step 2 of every OTP flow.
 *
 * One component for three flows, because after the code has been requested the
 * work is identical: show where the code went, take six digits, count the code
 * down, offer a resend once the cooldown has passed, and report a failure
 * without losing the user's place. The only things that differ are the copy and
 * two async calls, so those are the only things it takes.
 *
 * The panel does NOT hold the challenge. The parent owns it and re-renders this
 * with a fresh one after a resend, which is what restarts the countdown — so
 * there is exactly one copy of "which challenge are we on".
 *
 * ── Why the clock is state, not a render-time read ─────────────────────────
 *
 * `Date.now()` during render is impure (and would freeze the countdown open, so
 * an expired code would look live forever). It is read in an effect instead and
 * published on a one-second interval — the same idiom MessageBubble uses for
 * the edit window.
 */
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, Icon, OtpInput } from "@/components/ui";
import {
  formatCountdown,
  otpErrorMessage,
  OTP_CODE_LENGTH,
  type OtpChallenge,
} from "@/lib/otp-client";

/** Which flow this is — the only thing the copy varies on. */
export type OtpPurposeKey = "signup" | "member" | "manager";

export interface OtpStepProps {
  /** The challenge currently in flight. Replaced by the parent after a resend. */
  challenge: OtpChallenge;
  purpose: OtpPurposeKey;
  /** Company name, for the two company-scoped flows. */
  companyName?: string | null;
  /** Enter the code. Throw (an `ApiError`) to show the message inline. */
  onVerify: (code: string) => Promise<void>;
  /** Issue a fresh challenge and return it, so the parent can store it. */
  onResend: () => Promise<OtpChallenge>;
  /** Return to step 1. Omitted where there is nothing to go back to. */
  onBack?: () => void;
  backLabel?: string;
  /** Extra note under the actions, e.g. which role the account will get. */
  footer?: ReactNode;
}

interface Clock {
  now: number;
  deadline: number;
  resendAt: number;
}

function copyFor(purpose: OtpPurposeKey, email: string, companyName?: string | null) {
  switch (purpose) {
    case "member":
      return {
        heading: "Confirm the member's email",
        lead: companyName
          ? `We sent a 6-digit code to ${email}. The account is created the moment it is entered, and they join ${companyName} as a Member.`
          : `We sent a 6-digit code to ${email}. The account is created the moment it is entered.`,
      };
    case "manager":
      return {
        heading: "Confirm the manager's email",
        lead: companyName
          ? `We sent a 6-digit code to ${email}. They become a manager of ${companyName} once the code is confirmed.`
          : `We sent a 6-digit code to ${email}. They become a manager once the code is confirmed.`,
      };
    default:
      return {
        heading: "Confirm your email address",
        lead: `We sent a 6-digit code to ${email}. Enter it and your account is created.`,
      };
  }
}

export function OtpStep({
  challenge,
  purpose,
  companyName = null,
  onVerify,
  onResend,
  onBack,
  backLabel = "Use a different email",
  footer,
}: OtpStepProps) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Bumped on every failed attempt so the field remounts — which is how the
   * first box regains focus without exposing an imperative focus API.
   */
  const [attempt, setAttempt] = useState(0);
  const [clock, setClock] = useState<Clock | null>(null);

  useEffect(() => {
    const deadline = Date.parse(challenge.expiresAt);
    const resendAt = Date.now() + challenge.resendAfterMs;
    // The clock can only start after mount — this is the one legitimate
    // synchronous set here, and it is what makes the countdown live.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start the countdown clock
    setClock({ now: Date.now(), deadline, resendAt });
    const id = setInterval(() => {
      setClock((c) => (c ? { ...c, now: Date.now() } : c));
    }, 1000);
    return () => clearInterval(id);
  }, [challenge.expiresAt, challenge.resendAfterMs]);

  const remainingMs = clock ? Math.max(0, clock.deadline - clock.now) : null;
  const expired = remainingMs !== null && remainingMs <= 0;
  const cooldownMs = clock
    ? Math.max(0, clock.resendAt - clock.now)
    : challenge.resendAfterMs;
  const cooldownActive = cooldownMs > 0;

  const { heading, lead } = copyFor(purpose, challenge.email, companyName);

  async function submit(candidate: string) {
    if (busy || expired || candidate.length !== OTP_CODE_LENGTH) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await onVerify(candidate);
      // Success normally unmounts this panel (navigation or dialog close). If
      // the caller keeps it mounted, leave the field as it is rather than
      // clearing a code that just worked.
    } catch (e) {
      setError(otpErrorMessage(e));
      setCode("");
      setAttempt((a) => a + 1);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (resending || busy) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      await onResend();
      setCode("");
      setAttempt((a) => a + 1);
      setNotice(`A new code is on its way to ${challenge.email}.`);
    } catch (e) {
      setError(otpErrorMessage(e));
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-strong"
        >
          <Icon name="mail" size={20} />
        </span>
        <div className="min-w-0">
          <p className="text-body-sm font-semibold text-ink">{heading}</p>
          <p className="mt-0.5 text-caption leading-relaxed text-ink-2">{lead}</p>
        </div>
      </div>

      <OtpInput
        key={attempt}
        value={code}
        onChange={setCode}
        onComplete={(value) => void submit(value)}
        length={OTP_CODE_LENGTH}
        disabled={busy || expired}
        invalid={Boolean(error)}
        autoFocus
        label={`${OTP_CODE_LENGTH}-digit verification code`}
      />

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-caption font-medium text-danger-strong"
        >
          {error}
        </p>
      )}
      {notice && !error && (
        <p role="status" className="text-caption font-medium text-success-strong">
          {notice}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className="flex items-center gap-1.5 text-caption text-ink-3">
          <Icon name="clock" size={14} aria-hidden />
          {expired ? (
            <span className="font-medium text-danger">This code has expired</span>
          ) : (
            // Width is reserved so the row does not shift as the clock runs down.
            <span className="tabular-nums">
              {remainingMs === null ? "\u00a0" : `${formatCountdown(remainingMs)} left`}
            </span>
          )}
        </span>
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => void resend()}
          loading={resending}
          disabled={cooldownActive || busy}
          title={cooldownActive ? "Please wait before requesting another code" : undefined}
        >
          {cooldownActive ? `Resend in ${formatCountdown(cooldownMs)}` : "Send a new code"}
        </Button>
      </div>

      <Button
        type="button"
        size="lg"
        fullWidth
        loading={busy}
        disabled={code.length !== OTP_CODE_LENGTH || expired}
        onClick={() => void submit(code)}
      >
        <Icon name="key" size={18} aria-hidden />
        Verify and continue
      </Button>

      {onBack && (
        <Button type="button" variant="ghost" size="sm" fullWidth onClick={onBack} disabled={busy}>
          <Icon name="chevronLeft" size={16} aria-hidden />
          {backLabel}
        </Button>
      )}

      {footer && <p className="text-caption leading-relaxed text-ink-3">{footer}</p>}
    </div>
  );
}
