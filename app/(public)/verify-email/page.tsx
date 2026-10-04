/**
 * app/(public)/verify-email/page.tsx — email verification.
 *
 * - `?token=…`: verifies immediately, shows success/error.
 * - `?pending=1`: just signed up — "check your inbox" state with resend.
 * On success the session is refreshed, any pending signup avatar is applied,
 * and the user is sent to /home.
 */
"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Button, ErrorState, LoadingState, SuccessState } from "@/components/ui";
import { apiPost, ApiError, uploadFile, apiPatch } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import { takePendingAvatar } from "@/lib/pending-avatar";
import type { SessionUser } from "@/lib/api-types";
import { AuthShell } from "../_components/auth-shell";

type Status = "idle" | "verifying" | "success" | "error";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");
  const pending = searchParams.get("pending") === "1";
  const { user, refresh, updateUser } = useSession();
  const [status, setStatus] = useState<Status>(token ? "verifying" : "idle");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!token || attempted.current === token) return;
    attempted.current = token;
    let cancelled = false;
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      try {
        await apiPost("/api/auth/verify-email", { token });
        if (cancelled) return;
        // Apply a stashed signup avatar now that the email is verified.
        const avatar = takePendingAvatar();
        if (avatar) {
          try {
            const uploaded = await uploadFile("avatar", avatar);
            const updated = await apiPatch<SessionUser>("/api/users/me", { avatarUrl: uploaded.url });
            updateUser({ avatarUrl: updated.avatarUrl });
          } catch {
            /* avatar is optional — never block verification */
          }
        }
        await refresh();
        setStatus("success");
        // Give the success state a beat, then enter the app.
        // Route-group change re-runs the (app) layout, seeding the session.
        redirectTimer = setTimeout(() => {
          router.push("/home");
        }, 1600);
      } catch (e) {
        if (cancelled) return;
        setErrorCode(e instanceof ApiError ? e.code : "UNKNOWN_ERROR");
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (redirectTimer) clearTimeout(redirectTimer);
    };
  }, [token, refresh, updateUser, router]);

  const resend = async () => {
    setResending(true);
    try {
      await apiPost("/api/auth/resend-verification", {});
      setResent(true);
    } catch (e) {
      setErrorCode(e instanceof ApiError ? e.code : "UNKNOWN_ERROR");
    } finally {
      setResending(false);
    }
  };

  const errorMessage =
    errorCode === "TOKEN_EXPIRED"
      ? "This verification link has expired. Request a new one below."
      : errorCode === "TOKEN_USED"
        ? "This link was already used. Try logging in — your email may already be verified."
        : errorCode === "RATE_LIMITED"
          ? "Please wait a minute before requesting another email."
          : "This verification link is invalid. Request a new one below.";

  return (
    <AuthShell
      title="Verify your email"
      subtitle="One quick step to unlock posting, commenting, and messaging."
      footer={
        <>
          <Link href="/login" className="font-semibold text-brand-strong hover:underline">
            Back to log in
          </Link>
        </>
      }
    >
      {status === "verifying" && <LoadingState message="Verifying your email…" />}
      {status === "success" && (
        <SuccessState
          title="Email verified!"
          description="Welcome to AvoMessage. Taking you to your home feed…"
        />
      )}
      {status === "error" && (
        <div className="flex flex-col gap-5">
          <ErrorState title="Verification failed" message={errorMessage} />
          <Button fullWidth loading={resending} onClick={() => void resend()}>
            {resent ? "Email sent — check your inbox" : "Resend verification email"}
          </Button>
        </div>
      )}
      {status === "idle" && user?.emailVerified && (
        <div className="flex flex-col gap-5">
          <SuccessState
            title="Already verified"
            description="Your email is verified — you're all set."
            actionLabel="Go to home"
            onAction={() => router.push("/home")}
          />
        </div>
      )}
      {status === "idle" && !user?.emailVerified && (
        <div className="flex flex-col gap-5">
          <div className="rounded-xl border border-line bg-surface p-5 text-center">
            <p className="text-body font-medium text-ink">
              {pending ? "You're almost there!" : "Check your inbox"}
            </p>
            <p className="mt-2 text-body-sm text-ink-2">
              We sent a verification link{user?.email ? <> to <span className="font-semibold text-ink">{user.email}</span></> : ""}.
              Click it to verify your email address.
            </p>
          </div>
          <Button fullWidth variant="outline" loading={resending} onClick={() => void resend()}>
            {resent ? "Email sent — check your inbox" : "Resend verification email"}
          </Button>
          {resent && (
            <p role="status" className="text-center text-caption text-ink-3">
              If you don&apos;t see it, check your spam folder.
            </p>
          )}
        </div>
      )}
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<LoadingState message="Loading…" />}>
      <VerifyEmailContent />
    </Suspense>
  );
}
