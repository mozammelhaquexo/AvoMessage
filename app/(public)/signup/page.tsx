/**
 * app/(public)/signup/page.tsx — create an account.
 *
 * Two steps, and the split is the point: step 1 posts the form and gets a
 * 6-digit code; step 2 posts the code and only then does the account exist. The
 * server holds the pending name/username/email/password on the challenge, so
 * step 2 carries nothing but an id and six digits — see lib/services/otp.ts.
 *
 * Fields (step 1): full name, username, email, password, confirm password,
 * optional profile image. Client mirrors the server validation; the avatar is
 * stashed in-memory (uploads require a verified email) and applied once the
 * shell sees a verified session.
 */
"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Avatar, Button, Checkbox, FormField, Icon, Input, ProgressBar } from "@/components/ui";
import { OtpStep } from "@/components/auth/otp-step";
import { useSession } from "@/lib/auth-client";
import { apiGet, apiPost } from "@/lib/api-client";
import type { UsernameAvailability } from "@/lib/api-types";
import type { OtpChallenge } from "@/lib/otp-client";
import { setPendingAvatar } from "@/lib/pending-avatar";
import { AuthShell } from "../_components/auth-shell";

const USERNAME_RE = /^[a-zA-Z0-9_]+$/;

/** Local format rules for a username — the server re-checks these. */
function usernameFormatError(u: string): string | null {
  if (u.length < 3) return "Username must be at least 3 characters.";
  if (u.length > 24) return "Username must be at most 24 characters.";
  if (!USERNAME_RE.test(u)) return "Only letters, numbers, and underscores.";
  return null;
}

/** Debounce before the availability probe, in ms. */
const USERNAME_DEBOUNCE_MS = 450;

interface Values {
  name: string;
  username: string;
  email: string;
  password: string;
  confirm: string;
}

function validate(v: Values): Record<keyof Values, string | null> {
  return {
    name:
      v.name.trim().length === 0
        ? "Please enter your full name."
        : v.name.trim().length > 80
          ? "Name must be at most 80 characters."
          : null,
    username: usernameFormatError(v.username),
    email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()) ? "Enter a valid email address." : null,
    password:
      v.password.length < 8
        ? "Password must be at least 8 characters."
        : v.password.length > 128
          ? "Password must be at most 128 characters."
          : null,
    confirm: v.confirm !== v.password ? "Passwords don't match." : null,
  };
}

/** Rough password-strength score 0–4 for the meter. */
function passwordScore(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

const SCORE_LABEL = ["", "Weak", "Fair", "Good", "Strong"];

export default function SignupPage() {
  const { requestSignup, verifySignupOtp } = useSession();
  const router = useRouter();
  const [values, setValues] = useState<Values>({ name: "", username: "", email: "", password: "", confirm: "" });
  /** Non-null once a code has been sent — switches the page to step 2. */
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [touched, setTouched] = useState<Record<keyof Values, boolean>>({
    name: false,
    username: false,
    email: false,
    password: false,
    confirm: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [agree, setAgree] = useState(false);
  const [agreeError, setAgreeError] = useState<string | null>(null);
  /**
   * The last availability answer, tagged with the name it was asked about —
   * so a stale response for an older value can never be shown as if it were
   * the current one. `available: null` means the probe failed.
   */
  const [usernameCheck, setUsernameCheck] = useState<{
    for: string;
    available: boolean | null;
    reason: string | null;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const errors = validate(values);
  const score = passwordScore(values.password);

  /**
   * Debounced uniqueness probe (feature 7). Local format rules run first so we
   * never ask the server about a name that is already invalid, and a failed
   * probe degrades to "unknown" rather than blocking — the sign-up POST is the
   * real gate, and it maps a duplicate to a 409.
   *
   * Nothing is set synchronously in the effect body; the status below is
   * derived from `usernameCheck`, which is what keeps this free of the
   * cascading-render warning the rest of the codebase carries.
   */
  useEffect(() => {
    const name = values.username;
    if (usernameFormatError(name)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      apiGet<UsernameAvailability>("/api/auth/username-available", { params: { username: name } })
        .then((res) => {
          if (!cancelled) setUsernameCheck({ for: name, available: res.available, reason: res.reason });
        })
        .catch(() => {
          if (!cancelled) setUsernameCheck({ for: name, available: null, reason: null });
        });
    }, USERNAME_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [values.username]);

  const check = usernameCheck && usernameCheck.for === values.username ? usernameCheck : null;
  const usernameStatus: "idle" | "checking" | "available" | "taken" =
    usernameFormatError(values.username) || check?.available === null
      ? "idle"
      : !check
        ? "checking"
        : check.available
          ? "available"
          : "taken";

  // The field shows the local format error first, then a server "taken".
  const usernameError =
    (touched.username ? errors.username : null) ??
    (usernameStatus === "taken" ? (check?.reason ?? "That username is already taken.") : null);

  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));
  const blur = (key: keyof Values) => () => setTouched((t) => ({ ...t, [key]: true }));

  const pickAvatar = (file: File | undefined) => {
    setAvatarError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarError("Please choose an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError("Image must be at most 5 MB.");
      return;
    }
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  /** The account details, in the shape both the request and the resend want. */
  const signupBody = () => ({
    name: values.name.trim(),
    username: values.username,
    email: values.email.trim(),
    password: values.password,
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ name: true, username: true, email: true, password: true, confirm: true });
    const errs = validate(values);
    setAgreeError(agree ? null : "Please accept the Terms and Conditions to continue.");
    // The agree box and the uniqueness result are both hard gates. The server
    // re-checks both, but blocking here avoids a pointless round-trip.
    if (Object.values(errs).some(Boolean) || !agree || usernameStatus === "taken") return;
    setSubmitting(true);
    setServerError(null);
    try {
      const issued = await requestSignup(signupBody());
      // Avatar uploads require a verified email — stash it, and the app shell
      // applies it as soon as the OTP-verified session appears.
      if (avatarFile) setPendingAvatar(avatarFile);
      setChallenge(issued);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Sign-up failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Step 2. The account does not exist until this resolves — and when it does,
   * the address is already proven, so there is no verification link to follow.
   */
  if (challenge) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="One more step and your account is ready."
        footer={
          <>
            Wrong address?{" "}
            <button
              type="button"
              onClick={() => setChallenge(null)}
              className="font-semibold text-brand-strong hover:underline"
            >
              Go back and edit it
            </button>
          </>
        }
      >
        <OtpStep
          challenge={challenge}
          purpose="signup"
          onVerify={async (code) => {
            await verifySignupOtp(challenge.challengeId, code);
            router.push("/");
          }}
          // Deliberately a raw call rather than the provider's `requestSignup`:
          // a resend can fail with OTP_RESEND_TOO_SOON or RATE_LIMITED, and the
          // panel needs the original ApiError code to explain which one it was.
          onResend={() => apiPost<OtpChallenge>("/api/auth/register", signupBody())}
          footer="The code is valid for 10 minutes. If it does not arrive, check your spam folder."
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Join AvoMessage — it's free, and takes less than a minute."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-brand-strong hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        {serverError && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-body-sm font-medium text-danger-strong"
          >
            {serverError}
          </motion.p>
        )}

        {/* Avatar picker */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label={avatarFile ? "Change profile photo" : "Add a profile photo (optional)"}
            className="relative shrink-0 rounded-full transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-brand"
          >
            <Avatar src={avatarPreview} name={values.name || "You"} size="xl" />
            <span
              aria-hidden
              className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-canvas bg-brand-cta text-on-brand"
            >
              <Icon name={avatarFile ? "edit" : "plus"} size={14} />
            </span>
          </button>
          <div className="min-w-0">
            <p className="text-body-sm font-medium text-ink">Profile photo <span className="font-normal text-ink-3">(optional)</span></p>
            <p className="text-caption text-ink-3">JPG, PNG, or WebP · up to 5 MB. Applied after email verification.</p>
            {avatarError && (
              <p role="alert" className="mt-1 text-caption font-medium text-danger">{avatarError}</p>
            )}
            {avatarFile && (
              <button
                type="button"
                onClick={() => {
                  setAvatarFile(null);
                  if (avatarPreview) URL.revokeObjectURL(avatarPreview);
                  setAvatarPreview(null);
                }}
                className="mt-1 text-caption font-medium text-danger-strong hover:underline"
              >
                Remove photo
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label="Choose a profile photo"
            onChange={(e) => {
              pickAvatar(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>

        <FormField label="Full name" required error={touched.name ? errors.name ?? undefined : undefined}>
          {({ id, ...fp }) => (
            <Input id={id} {...fp} autoComplete="name" placeholder="Ada Lovelace" value={values.name} onChange={set("name")} onBlur={blur("name")} />
          )}
        </FormField>

        <FormField
          label="Username"
          required
          error={usernameError ?? undefined}
          hint={
            usernameStatus === "checking" ? (
              "Checking availability…"
            ) : usernameStatus === "available" ? (
              <span className="font-medium text-success-strong">@{values.username} is available</span>
            ) : (
              "3–24 characters · letters, numbers, underscores"
            )
          }
        >
          {({ id, ...fp }) => (
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-body-sm text-ink-3">@</span>
              <Input id={id} {...fp} autoComplete="username" placeholder="ada" value={values.username} onChange={set("username")} onBlur={blur("username")} className="pl-8" />
            </div>
          )}
        </FormField>

        <FormField label="Email" required error={touched.email ? errors.email ?? undefined : undefined}>
          {({ id, ...fp }) => (
            <Input id={id} {...fp} type="email" autoComplete="email" placeholder="you@example.com" value={values.email} onChange={set("email")} onBlur={blur("email")} />
          )}
        </FormField>

        <FormField label="Password" required error={touched.password ? errors.password ?? undefined : undefined}>
          {({ id, ...fp }) => (
            <>
              <div className="relative">
                <Input
                  id={id}
                  {...fp}
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={values.password}
                  onChange={set("password")}
                  onBlur={blur("password")}
                  className="pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <Icon name={showPassword ? "eyeOff" : "eye"} size={18} />
                </button>
              </div>
              {values.password && (
                <div className="mt-2 flex items-center gap-2" aria-live="polite">
                  <ProgressBar value={(score / 4) * 100} label={`Password strength: ${SCORE_LABEL[score]}`} size="sm" className="flex-1" />
                  <span className="text-caption font-medium text-ink-2">{SCORE_LABEL[score]}</span>
                </div>
              )}
            </>
          )}
        </FormField>

        <FormField label="Confirm password" required error={touched.confirm ? errors.confirm ?? undefined : undefined}>
          {({ id, ...fp }) => (
            <Input id={id} {...fp} type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Repeat your password" value={values.confirm} onChange={set("confirm")} onBlur={blur("confirm")} />
          )}
        </FormField>

        {/* Feature 6 — mandatory agreement, linked to the Terms page. */}
        <div className="flex flex-col gap-1">
          <Checkbox
            checked={agree}
            onChange={(e) => {
              setAgree(e.target.checked);
              if (e.target.checked) setAgreeError(null);
            }}
            invalid={Boolean(agreeError)}
            label={
              <>
                I agree to the{" "}
                <Link href="/terms" className="font-semibold text-brand-strong hover:underline">
                  Terms and Conditions
                </Link>
              </>
            }
          />
          {agreeError && (
            <p role="alert" className="text-caption font-medium text-danger">
              {agreeError}
            </p>
          )}
        </div>

        <Button type="submit" size="lg" fullWidth loading={submitting}>
          Create account
        </Button>
        <p className="text-center text-caption text-ink-3">
          We&apos;ll email you a 6-digit code to confirm it&apos;s you. Your account is created once
          you enter it.
        </p>
      </form>
    </AuthShell>
  );
}
