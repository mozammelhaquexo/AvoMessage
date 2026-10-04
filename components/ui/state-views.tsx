"use client";

/**
 * StateViews — reusable loading / empty / error / success states.
 * Used app-wide so no page ever renders a blank screen. All views are
 * theme-aware, keyboard-accessible, and use the expressive icon set
 * (no emoji).
 */

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "./utils";
import { Icon, type IconName } from "./icons";
import { Button, type ButtonProps } from "./button";
import { Spinner } from "./spinner";
import { fadeUp } from "@/lib/motion";

/* ------------------------------------------------------------------ */

interface StateShellProps {
  icon: IconName;
  iconTone?: "brand" | "neutral" | "danger" | "success";
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

const iconTones = {
  brand: "bg-brand-soft text-brand-strong",
  neutral: "bg-surface-2 text-ink-3",
  danger: "bg-danger/10 text-danger",
  success: "bg-success/10 text-success",
} as const;

function StateShell({
  icon,
  iconTone = "neutral",
  title,
  description,
  action,
  className,
  compact,
}: StateShellProps) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="show"
      role="status"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 py-6" : "gap-3 px-6 py-12",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex items-center justify-center rounded-full",
          compact ? "h-11 w-11" : "h-16 w-16",
          iconTones[iconTone],
        )}
      >
        <Icon name={icon} size={compact ? 20 : 28} />
      </span>
      <h3 className={cn("font-semibold text-ink", compact ? "text-body-sm" : "text-h3")}>
        {title}
      </h3>
      {description && (
        <p className={cn("max-w-sm text-ink-2", compact ? "text-caption" : "text-body-sm")}>
          {description}
        </p>
      )}
      {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */

export interface LoadingStateProps {
  message?: string;
  className?: string;
  compact?: boolean;
}

/** Indeterminate loading state with announcement for screen readers. */
export function LoadingState({ message = "Loading…", className, compact }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3",
        compact ? "py-6" : "py-12",
        className,
      )}
    >
      <Spinner size={compact ? "sm" : "lg"} label={message} />
      <p className="text-body-sm text-ink-2">{message}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: ButtonProps["variant"];
  className?: string;
  compact?: boolean;
}

/** Friendly empty state with optional CTA. */
export function EmptyState({
  icon = "search",
  title,
  description,
  actionLabel,
  onAction,
  actionVariant = "primary",
  className,
  compact,
}: EmptyStateProps) {
  return (
    <StateShell
      icon={icon}
      iconTone="neutral"
      title={title}
      description={description}
      compact={compact}
      className={className}
      action={
        actionLabel && onAction ? (
          <Button variant={actionVariant} size={compact ? "sm" : "md"} onClick={onAction}>
            {actionLabel}
          </Button>
        ) : undefined
      }
    />
  );
}

/* ------------------------------------------------------------------ */

export interface ErrorStateProps {
  title?: string;
  message?: ReactNode;
  /** Retry handler — renders a retry button when provided. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
  compact?: boolean;
}

/** Error state with retry. Announced assertively. */
export function ErrorState({
  title = "Something went wrong",
  message = "We couldn't load this right now. Please try again.",
  onRetry,
  retryLabel = "Try again",
  className,
  compact,
}: ErrorStateProps) {
  return (
    <div role="alert" className={className}>
      <StateShell
        icon="alert"
        iconTone="danger"
        title={title}
        description={message}
        compact={compact}
        action={
          onRetry ? (
            <Button variant="outline" size={compact ? "sm" : "md"} onClick={onRetry}>
              <Icon name="refresh" size={16} />
              {retryLabel}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

export interface SuccessStateProps {
  title: string;
  description?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  compact?: boolean;
}

/** Confirmation state for completed flows. */
export function SuccessState({
  title,
  description,
  actionLabel,
  onAction,
  className,
  compact,
}: SuccessStateProps) {
  return (
    <StateShell
      icon="check"
      iconTone="success"
      title={title}
      description={description}
      compact={compact}
      className={className}
      action={
        actionLabel && onAction ? (
          <Button variant="primary" size={compact ? "sm" : "md"} onClick={onAction}>
            {actionLabel}
          </Button>
        ) : undefined
      }
    />
  );
}
