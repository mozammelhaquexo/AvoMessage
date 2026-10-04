/**
 * app/(public)/forgot-password/page.tsx — request a password reset link.
 * Always shows success (no account enumeration — server returns ok always).
 */
"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, FormField, Input, SuccessState } from "@/components/ui";
import { apiPost } from "@/lib/api-client";
import { AuthShell } from "../_components/auth-shell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const emailError =
    touched && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      ? "Enter a valid email address."
      : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (emailError || !email.trim()) return;
    setSubmitting(true);
    try {
      await apiPost("/api/auth/forgot-password", { email: email.trim() });
    } catch {
      // Always show success — the endpoint never reveals account existence.
    } finally {
      setSubmitting(false);
      setSent(true);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email you signed up with and we'll send you a reset link."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-brand-strong hover:underline">
            Back to log in
          </Link>
        </>
      }
    >
      {sent ? (
        <SuccessState
          title="Check your inbox"
          description={
            <>
              If an account exists for <span className="font-semibold text-ink">{email.trim()}</span>,
              a password reset link is on its way. It expires in 1 hour.
            </>
          }
        />
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <FormField label="Email" required error={emailError ?? undefined}>
            {({ id, ...fp }) => (
              <Input
                id={id}
                {...fp}
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched(true)}
              />
            )}
          </FormField>
          <Button type="submit" size="lg" fullWidth loading={submitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
