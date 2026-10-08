/**
 * lib/display-name.ts — the one place that decides what to call somebody.
 *
 * WHY THIS IS ITS OWN MODULE
 * The precedence rule below is needed by the server serializer AND by the
 * nickname service, and putting it in either one would make them import each
 * other (`serialize` → `nicknames` → `serialize`). It has no dependencies at
 * all, so it costs nothing to keep it separate — and being dependency-free is
 * also what makes the rule trivially testable.
 *
 * THE RULE
 *   1. the viewer's private rename of this person,
 *   2. the person's own nickname inside this group,
 *   3. their real name.
 *
 * The private rename wins because it is the most deliberate choice by the
 * person doing the looking, and it is the only one that is theirs alone to
 * make. The real name is the last resort, so nobody is ever nameless.
 *
 * This lives outside `lib/services/` on purpose: it is presentation logic that
 * both the server and (potentially) the client need, not a database concern.
 */

/** The longest nickname the database column will hold. Mirrors the schema. */
export const NICKNAME_MAX = 60;

export interface DisplayNameSources {
  /** `User.name` — always present, always the fallback. */
  realName: string;
  /** The member's own name inside this group, if they set one. */
  groupNickname?: string | null;
  /** The viewer's private rename of this person, if they made one. */
  contactNickname?: string | null;
}

/**
 * Resolve what to render for a member.
 *
 * `||` rather than `??` on purpose: a row holding an empty string — a legacy
 * write, or a hand-edited database — should fall through to the next source
 * rather than render as a nameless member.
 */
export function resolveDisplayName(input: DisplayNameSources): string {
  return input.contactNickname?.trim() || input.groupNickname?.trim() || input.realName;
}
