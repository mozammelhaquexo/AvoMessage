/**
 * components/chat/NicknameEditor.tsx — set or clear what YOU call somebody.
 *
 * WHY THIS IS ONE COMPONENT USED TWICE
 * Two features need the same control with different endpoints:
 *
 *   - a DM's private contact nickname   → `PUT /api/nicknames`
 *   - your own name inside a group      → `PUT /api/conversations/:id/members/:me/nickname`
 *
 * They differ only in where the write goes, so the endpoint is the caller's
 * job (`onSave`) and everything a user actually sees — the field, the disabled
 * states, the toasts, the re-sync after a refetch — lives here once. Two
 * copies would drift, and the one nobody looked at would be the one that
 * quietly stopped clearing.
 *
 * BLANK IS NOT "CLEAR"
 * Submitting an empty box is refused, and clearing is an explicit "Remove"
 * button that only appears when there is something to remove. Treating a blank
 * as a clear makes a mistyped space look like a deliberate reset, and it means
 * a user who empties the field by accident silently loses the nickname.
 */
"use client";

import { useId, useState } from "react";
import { Button, Input, toast } from "@/components/ui";

export interface NicknameEditorProps {
  /** The current nickname, or null when there is none. */
  value: string | null;
  /** The person's real name. Shown as the placeholder so it is clear who this renames. */
  realName: string;
  /** Label above the field. */
  label: string;
  /** Optional explanation under the field. */
  hint?: string;
  /** Persist the value. `null` clears it. Throw to surface a failure. */
  onSave: (nickname: string | null) => Promise<void>;
  /** Called after a successful write, so the parent can refetch. */
  onSaved?: () => void;
}

export function NicknameEditor({
  value,
  realName,
  label,
  hint,
  onSave,
  onSaved,
}: NicknameEditorProps) {
  const id = useId();
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);

  /*
   * Re-sync when the stored value changes — a save triggers a refetch, and the
   * drawer can be reopened with a value the component has never seen. Done
   * during render (React's documented "adjust state when a prop changes"
   * pattern) rather than in an effect, which would render one frame with the
   * stale text first.
   */
  const [syncedFrom, setSyncedFrom] = useState(value);
  if (value !== syncedFrom) {
    setSyncedFrom(value);
    setDraft(value ?? "");
  }

  const trimmed = draft.trim();
  const unchanged = trimmed === (value ?? "");

  async function save(next: string | null) {
    setBusy(true);
    try {
      await onSave(next);
      toast({
        variant: "success",
        title: next === null ? "Nickname removed" : "Nickname saved",
      });
      onSaved?.();
    } catch (e) {
      toast({
        variant: "error",
        title: e instanceof Error ? e.message : "Could not save the nickname",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="text-caption font-semibold uppercase tracking-wider text-ink-3"
      >
        {label}
      </label>
      <Input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && trimmed && !unchanged) {
            e.preventDefault();
            void save(trimmed);
          }
        }}
        // 60 is the column width, so the field cannot produce a value the
        // server would reject.
        maxLength={60}
        placeholder={realName}
        aria-label={label}
        disabled={busy}
      />
      {hint && <p className="text-caption text-ink-3">{hint}</p>}
      <div className="flex justify-end gap-2">
        {value !== null && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save(null)}>
            Remove
          </Button>
        )}
        <Button
          size="sm"
          loading={busy}
          disabled={busy || !trimmed || unchanged}
          onClick={() => void save(trimmed)}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
