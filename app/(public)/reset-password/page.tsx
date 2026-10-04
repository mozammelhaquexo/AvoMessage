/**
 * app/(public)/reset-password/page.tsx — set a new password from a reset link.
 * `?token=…` — single-use, 1-hour expiry (server-enforced).
 */
"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Button, ErrorState, FormField, Icon, Input, LoadingState, SuccessState } from "@/components/ui";
import { apiPost, ApiError } from "@/lib/api-client";
import { AuthShell } from "../_components/auth-shell";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordError =
    touched && password.length < 8 ? "Password must be at least 8 characters." : null;
  const confirmError = touched && confirm !== password ? "Passwords don't match." : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!token || passwordError || confirmError || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiPost("/api/auth/reset-password", { token, password });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "TOKEN_EXPIRED" || err.code === "TOKEN_INVALID" || err.code === "TOKEN_USED")) {
        setError("This reset link is invalid or has expired. Request a new one.");
      } else {
        setError(err instanceof Error ? err.message : "Couldn't reset your password. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title="Reset your password">
        <ErrorState
          title="Missing reset link"
          message="This page needs a valid reset link from your email."
        />
        <div className="mt-5">
          <Button href="/forgot-password" fullWidth variant="outline">Request a new link</Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Make it strong — at least 8 characters."
      footer={
        <>
          <Link href="/login" className="font-semibold text-brand-strong hover:underline">
            Back to log in
          </Link>
        </>
      }
    >
      {done ? (
        <SuccessState
          title="Password updated"
          description="Your password has been changed and all other sessions were signed out. Log in with your new password."
          actionLabel="Log in"
          onAction={() => router.push("/login")}
        />
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          {error && (
            <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-body-sm font-medium text-danger-strong">
              {error}{" "}
              <Link href="/forgot-password" className="underline">Request a new link</Link>
            </p>
          )}
          <FormField label="New password" required error={passwordError ?? undefined}>
            {({ id, ...fp }) => (
              <div className="relative">
                <Input
                  id={id}
                  {...fp}
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setTouched(true)}
                  className="pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Hide password" : "Show password"}
                  aria-pressed={show}
                  className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <Icon name={show ? "eyeOff" : "eye"} size={18} />
                </button>
              </div>
            )}
          </FormField>
          <FormField label="Confirm new password" required error={confirmError ?? undefined}>
            {({ id, ...fp }) => (
              <Input
                id={id}
                {...fp}
                type={show ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Repeat your new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onBlur={() => setTouched(true)}
              />
            )}
          </FormField>
          <Button type="submit" size="lg" fullWidth loading={submitting}>
            Update password
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<LoadingState message="Loading…" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
