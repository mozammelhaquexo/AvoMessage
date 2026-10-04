/**
 * components/admin/AdminModeration.tsx — /admin/moderation.
 * Direct moderation actions: delete post/comment/message or suspend a user
 * by ID. Every action is audited server-side and needs confirmation.
 */
"use client";

import { useState, type FormEvent } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  FormField,
  Icon,
  Input,
  Select,
  Textarea,
  toast,
} from "@/components/ui";
import { apiPost } from "@/lib/api-client";

type Action = "delete_post" | "delete_comment" | "delete_message" | "suspend_user";

const ACTION_META: Record<Action, { label: string; target: string; hint: string; targetTypes: string[] }> = {
  delete_post: {
    label: "Delete post",
    target: "Post ID",
    hint: "Soft-deletes the post for everyone.",
    targetTypes: ["POST"],
  },
  delete_comment: {
    label: "Delete comment",
    target: "Comment ID",
    hint: "Soft-deletes the comment and decrements the post counter.",
    targetTypes: ["COMMENT"],
  },
  delete_message: {
    label: "Delete message",
    target: "Message ID",
    hint: "Soft-deletes the message for all participants.",
    targetTypes: ["MESSAGE"],
  },
  suspend_user: {
    label: "Suspend user",
    target: "User ID",
    hint: "Deactivates the account and revokes all sessions immediately.",
    targetTypes: ["USER"],
  },
};

export function AdminModeration() {
  const [action, setAction] = useState<Action>("delete_post");
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const meta = ACTION_META[action];

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!targetId.trim()) return;
    setConfirming(true);
  }

  async function execute() {
    setBusy(true);
    try {
      await apiPost("/api/admin/moderation", {
        action,
        targetType: meta.targetTypes[0],
        targetId: targetId.trim(),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast({ variant: "success", title: `${meta.label} completed` });
      setTargetId("");
      setReason("");
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Moderation action failed" });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-h3">Take moderation action</CardTitle>
          <p className="text-body-sm text-ink-2">
            Direct actions outside the reports queue. Every action is written to the audit log.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FormField label="Action" required>
              {(fp) => (
                <Select
                  id={fp.id}
                  value={action}
                  onValueChange={(v) => setAction(v as Action)}
                  options={(Object.keys(ACTION_META) as Action[]).map((a) => ({
                    value: a,
                    label: ACTION_META[a].label,
                  }))}
                  label="Moderation action"
                />
              )}
            </FormField>
            <FormField label={meta.target} required>
              {(fp) => (
                <Input {...fp} value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="Paste the ID" className="font-mono" required />
              )}
            </FormField>
            <FormField label="Reason (optional)" hint="Stored in the audit log.">
              {(fp) => <Textarea {...fp} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />}
            </FormField>
            <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-body-sm text-warning-strong">
              <Icon name="alert" size={16} aria-hidden className="mt-0.5 shrink-0" />
              {meta.hint}
            </p>
            <div className="flex justify-end">
              <Button type="submit" variant="danger" disabled={!targetId.trim()}>
                <Icon name="shield" size={15} aria-hidden className="mr-1.5" />
                {meta.label}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`${meta.label}?`}
        description={`${meta.hint} This can't be undone from here.`}
        confirmLabel={meta.label}
        tone="danger"
        icon="shield"
        confirming={busy}
        onConfirm={() => void execute()}
      />
    </div>
  );
}
