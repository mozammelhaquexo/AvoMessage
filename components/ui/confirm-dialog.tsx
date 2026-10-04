"use client";

/**
 * ConfirmDialog — destructive/confirmation dialog built on Dialog.
 * Always requires an explicit choice; the confirm button gets initial
 * focus treatment via the dialog's focus trap (first focusable).
 */

import type { ReactNode } from "react";
import { Dialog, DialogFooter } from "./dialog";
import { Button } from "./button";
import { Icon, type IconName } from "./icons";
import { cn } from "./utils";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" renders a red confirm button; "default" uses primary. */
  tone?: "danger" | "default";
  icon?: IconName;
  onConfirm: () => void | Promise<void>;
  /** Set while the confirm action is running — shows spinner, blocks close. */
  confirming?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  icon = "alert",
  onConfirm,
  confirming = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={confirming ? () => {} : onOpenChange}
      title={
        <span className="flex items-center gap-3">
          <span
            aria-hidden
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
              tone === "danger" ? "bg-danger/10 text-danger" : "bg-brand-soft text-brand-strong",
            )}
          >
            <Icon name={icon} size={20} />
          </span>
          {title}
        </span>
      }
      description={description}
      size="sm"
      dismissable={!confirming}
      showClose={!confirming}
    >
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>
          {cancelLabel}
        </Button>
        <Button
          variant={tone === "danger" ? "danger" : "primary"}
          onClick={() => void onConfirm()}
          loading={confirming}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
