/**
 * lib/otp-client.ts — the browser-side half of the OTP flows.
 *
 * Three flows (public signup, manager-adds-member, admin-adds-manager) share
 * one wire shape and one set of error messages. Keeping both here means the
 * three forms cannot drift: a new OTP error code added on the server has one
 * place to be translated, and `OtpChallenge` has one definition.
 *
 * Deliberately NOT in `lib/api-types.ts`: that file is a type-only surface
 * imported by both server and client code, and this module carries runtime
 * behaviour (`ApiError` instanceof checks) plus the literal the UI counts
 * against. Types that describe a *response* belong next to their consumer.
 */
"use client";

import { ApiError } from "./api-client";

/** Digits in a code. Mirrors `OTP_LENGTH` in lib/services/otp.ts. */
export const OTP_CODE_LENGTH = 6;

/**
 * What a `POST …/otp` endpoint returns — step 1 of every flow.
 *
 * The client stores this and sends back only `challengeId` + `code` in step 2.
 * Nothing here is trusted as input: `email` is for display, `expiresAt` and
 * `resendAfterMs` only drive the countdowns. The authoritative copy of what was
 * asked for lives in the challenge row on the server.
 */
export interface OtpChallenge {
  challengeId: string;
  /** Normalised (lowercased) address the code was sent to. */
  email: string;
  /** ISO timestamp. */
  expiresAt: string;
  /** Milliseconds until a resend is accepted. */
  resendAfterMs: number;
  /**
   * The raw code, present in development only — the server decides with
   * NODE_ENV and ignores anything the client sends. Lets a developer finish a
   * flow without digging through an inbox.
   */
  devCode?: string;
}

/** The result of completing a flow — a created account, at minimum. */
export interface OtpCompletedUser {
  user: { id: string; name: string; username: string; email: string };
}

/**
 * Turn an OTP failure into something worth reading.
 *
 * The server's messages are already user-facing (they carry the attempts-left
 * count, which is genuinely useful), so the default is to pass them through.
 * Only the codes whose server message is too terse get their own copy here.
 */
export function otpErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "OTP_EXPIRED":
        return "That code has expired. Request a new one and try again.";
      case "OTP_USED":
        return "That code has already been used. Request a new one.";
      case "OTP_ATTEMPTS_EXCEEDED":
        return "Too many incorrect attempts. Request a new code.";
      case "OTP_RESEND_TOO_SOON":
        return e.message || "Please wait a moment before requesting another code.";
      case "RATE_LIMITED":
        return "Too many requests from this device. Please wait a minute and try again.";
      case "NETWORK_ERROR":
        return "Could not reach AvoMessage. Check your connection and try again.";
      default:
        return e.message;
    }
  }
  return e instanceof Error ? e.message : "That code could not be verified. Please try again.";
}

/**
 * `m:ss` for a countdown. Sub-minute values keep the leading `0:` rather than
 * switching shape, so the width does not jump as the clock runs down.
 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
