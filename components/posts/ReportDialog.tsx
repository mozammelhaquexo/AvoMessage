/**
 * components/posts/ReportDialog.tsx — report a post, comment, message, or user.
 * Reason categories come from the backend's reportCreateSchema (see
 * lib/validation.ts) — POST /api/reports { targetType, targetId, reason, details? }.
 */
"use client";

import { useState } from "react";
import { Button, Dialog, FormField, Select, Textarea, toast } from "@/components/ui";
import { apiPost, ApiError } from "@/lib/api-client";

export type ReportTargetType = "POST" | "COMMENT" | "MESSAGE" | "USER";

const REASONS = [
  { value: "SPAM", label: "Spam or misleading" },
  { value: "HARASSMENT", label: "Harassment or bullying" },
  { value: "HATE_SPEECH", label: "Hate speech" },
  { value: "NUDITY_OR_SEXUAL", label: "Nudity or sexual content" },
  { value: "VIOLENCE", label: "Violence or threats" },
  { value: "MISINFORMATION", label: "Misinformation" },
  { value: "COPYRIGHT", label: "Copyright violation" },
  { value: "OTHER", label: "Something else" },
] as const;

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: ReportTargetType;
  targetId: string;
  targetLabel?: string;
  onReported?: () => void;
}

export function ReportDialog({
  open,
  onOpenChange,
  targetType,
  targetId,
  targetLabel,
  onReported,
}: ReportDialogProps) {
  const [reason, setReason] = useState<string>("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason) {
      setError("Please choose a reason.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiPost("/api/reports", {
        targetType,
        targetId,
        reason,
        details: details.trim() || undefined,
      });
      toast({ variant: "success", title: "Report submitted", description: "Our moderation team will review it." });
      onOpenChange(false);
      setReason("");
      setDetails("");
      onReported?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not submit the report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Report content"
      description={
        targetLabel ? (
          <>You&apos;re reporting {targetLabel}. Reports are reviewed by moderators.</>
        ) : (
          "Reports are reviewed by moderators."
        )
      }
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <FormField label="Reason" required error={error ?? undefined}>
          {({ id }) => (
            <Select
              id={id}
              label="Report reason"
              value={reason}
              invalid={!!error}
              onValueChange={(v) => {
                setReason(v);
                setError(null);
              }}
              options={REASONS.map((r) => ({ value: r.value, label: r.label }))}
              placeholder="Choose a reason…"
            />
          )}
        </FormField>
        <FormField label="Details (optional)" hint="Anything that helps a moderator understand the issue.">
          {({ id, ...fieldProps }) => (
            <Textarea
              id={id}
              {...fieldProps}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Optional context…"
            />
          )}
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={submitting} onClick={() => void submit()}>
            Submit report
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
