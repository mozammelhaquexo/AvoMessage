/**
 * Password rules + an advisory strength score for the change-password form.
 *
 * `MIN_PASSWORD_LENGTH` must match `passwordSchema` in lib/validation.ts —
 * the form's hard gate mirrors the server exactly, so a password the API would
 * accept is never blocked client-side. The strength score is guidance only and
 * never blocks submission.
 */

/** Mirrors `passwordSchema` in lib/validation.ts (`z.string().min(8)`). */
export const MIN_PASSWORD_LENGTH = 8;

export type PasswordStrengthLabel = "Weak" | "Fair" | "Good" | "Strong";

export interface PasswordStrength {
  /** 0–4, matching the four segments of the meter. */
  score: number;
  label: PasswordStrengthLabel | "";
}

export function passwordStrength(pw: string): PasswordStrength {
  if (!pw) return { score: 0, label: "" };
  let points = 0;
  if (pw.length >= MIN_PASSWORD_LENGTH) points += 1;
  if (pw.length >= 12) points += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) points += 1;
  if (/\d/.test(pw)) points += 1;
  if (/[^A-Za-z0-9]/.test(pw)) points += 1;

  if (points <= 1) return { score: 1, label: "Weak" };
  if (points === 2) return { score: 2, label: "Fair" };
  if (points <= 4) return { score: 3, label: "Good" };
  return { score: 4, label: "Strong" };
}

export interface PasswordFieldErrors {
  next: string | null;
  confirm: string | null;
}

/**
 * Validation messages for the new-password fields. Returns `null` for a field
 * that is not wrong — an empty field only counts once the user has interacted
 * with it (the caller decides when to show them).
 */
export function passwordFieldErrors(next: string, confirm: string): PasswordFieldErrors {
  return {
    next:
      next.length === 0
        ? "Choose a new password."
        : next.length < MIN_PASSWORD_LENGTH
          ? `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`
          : null,
    confirm:
      confirm.length === 0
        ? "Re-enter the new password."
        : confirm !== next
          ? "Passwords don't match."
          : null,
  };
}
