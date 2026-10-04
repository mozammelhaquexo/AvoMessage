import type { HTMLAttributes } from "react";
import { cn } from "./utils";

/**
 * Skeleton — shimmering placeholder for loading content.
 * `aria-hidden` by default; the loading region itself should carry
 * `aria-busy` / a status announcement.
 */

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Preset shapes. */
  variant?: "text" | "avatar" | "block" | "circle";
}

const variantStyles: Record<NonNullable<SkeletonProps["variant"]>, string> = {
  text: "h-4 rounded-sm",
  avatar: "h-11 w-11 rounded-full",
  circle: "rounded-full",
  block: "rounded-md",
};

export function Skeleton({ variant = "block", className, ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "skeleton-shimmer",
        variantStyles[variant],
        className,
      )}
      {...rest}
    />
  );
}

/** Convenience: a stack of text-line skeletons. */
export function SkeletonLines({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          className={i === lines - 1 ? "w-2/3" : "w-full"}
        />
      ))}
    </div>
  );
}
