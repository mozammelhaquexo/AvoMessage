/**
 * app/(public)/login/page.tsx — sign in.
 *
 * Owned by Frontend Engineer A. Animated validation, password visibility
 * toggle, `next` redirect support, and clear error feedback.
 */
"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Button, FormField, Icon, Input } from "@/components/ui";
import { useSession } from "@/lib/auth-client";
import { AuthShell } from "../_components/auth-shell";

function LoginForm() {
  const searchParams = useSearchParams();
  const { login } = useSession();
  const next = searchParams.get("next") || "/home";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const emailError =
    touched.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      ? "Enter a valid email address."
      : null;
  const passwordError =
    touched.password && password.length === 0 ? "Enter your password." : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ email: true, password: true });
    if (emailError || passwordError || !email.trim() || !password) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await login(email.trim(), password);
      // Hard navigation: guarantees the server layouts see the fresh session.
      window.location.href = next.startsWith("/") ? next : "/home";
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to pick up your conversations right where you left off."
      footer={
        <>
          New to AvoMessage?{" "}
          <Link href="/signup" className="font-semibold text-brand-strong hover:underline">
            Create an account
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
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            />
          )}
        </FormField>
        <FormField
          label="Password"
          required
          error={passwordError ?? undefined}
          hint={
            <Link href="/forgot-password" className="text-brand-strong hover:underline">
              Forgot your password?
            </Link>
          }
        >
          {({ id, ...fp }) => (
            <div className="relative">
              <Input
                id={id}
                {...fp}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, password: true }))}
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
          )}
        </FormField>
        <Button type="submit" size="lg" fullWidth loading={submitting}>
          Log in
        </Button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
