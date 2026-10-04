/**
 * lib/pending-avatar.ts — stash an avatar file chosen at signup.
 *
 * Uploads require a verified email (server-enforced), so an avatar picked on
 * the signup form can't be uploaded until verification completes. We keep the
 * File in memory for the tab session; after verification succeeds, the app
 * uploads it and PATCHes the profile. Never blocks auth flows.
 */
"use client";

let pending: File | null = null;

export function setPendingAvatar(file: File | null): void {
  pending = file;
}

export function takePendingAvatar(): File | null {
  const file = pending;
  pending = null;
  return file;
}

export function hasPendingAvatar(): boolean {
  return pending !== null;
}
