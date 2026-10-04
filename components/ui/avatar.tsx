"use client";

import { useState, type ImgHTMLAttributes } from "react";
import { cn } from "./utils";
import type { IconName } from "./icons";

/**
 * Avatar — image with graceful fallback to initials. Optional presence dot.
 */

export type PresenceStatus = "online" | "away" | "dnd" | "offline";

const presenceColor: Record<PresenceStatus, string> = {
  online: "bg-online",
  away: "bg-warning",
  dnd: "bg-danger",
  offline: "bg-offline",
};

const presenceLabel: Record<PresenceStatus, string> = {
  online: "Online",
  away: "Away",
  dnd: "Do not disturb",
  offline: "Offline",
};

/**
 * Server presence values are uppercase (`ONLINE` | `AWAY` | `DO_NOT_DISTURB` |
 * `OFFLINE`, see lib/realtime/events.ts). Map them to the dot's lowercase
 * union. Unknown/absent values are OFFLINE — never assume someone is online.
 */
export function toPresenceStatus(raw: string | null | undefined): PresenceStatus {
  switch (raw) {
    case "ONLINE":
      return "online";
    case "AWAY":
      return "away";
    case "DO_NOT_DISTURB":
      return "dnd";
    default:
      return "offline";
  }
}

/** Human-readable label for a raw server presence value. */
export function presenceLabelFor(raw: string | null | undefined): string {
  return presenceLabel[toPresenceStatus(raw)];
}

export function PresenceDot({
  status,
  className,
  ringClassName = "ring-surface",
}: {
  status: PresenceStatus;
  className?: string;
  ringClassName?: string;
}) {
  return (
    <span
      role="img"
      aria-label={presenceLabel[status]}
      title={presenceLabel[status]}
      className={cn(
        "block h-3.5 w-3.5 rounded-full ring-2",
        presenceColor[status],
        ringClassName,
        className,
      )}
    />
  );
}

const avatarSizes = {
  xs: "h-6 w-6 text-tiny",
  sm: "h-8 w-8 text-caption",
  md: "h-11 w-11 text-body-sm",
  lg: "h-14 w-14 text-h3",
  xl: "h-20 w-20 text-h2",
} as const;

export interface AvatarProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> {
  src?: string | null;
  /** Display name — used for initials fallback and alt text. */
  name: string;
  size?: keyof typeof avatarSizes;
  status?: PresenceStatus;
  /** Decorative icon fallback instead of initials (pass an IconName). */
  fallbackIcon?: IconName;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  src,
  name,
  size = "md",
  status,
  className,
  ...rest
}: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImage = src && !failed;

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {showImage ? (
        // Plain <img>: remote/user avatar URLs can't use next/image without a
        // loader allowlist, and we need onError for the initials fallback.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={cn(
            "rounded-full object-cover img-dim",
            avatarSizes[size],
            "bg-brand-soft",
          )}
          {...rest}
        />
      ) : (
        <span
          role="img"
          aria-label={name}
          className={cn(
            "bg-brand-gradient-soft flex items-center justify-center rounded-full font-semibold text-brand-strong",
            avatarSizes[size],
          )}
        >
          {initials(name)}
        </span>
      )}
      {status && (
        <span className="absolute -right-0.5 -bottom-0.5">
          <PresenceDot status={status} />
        </span>
      )}
    </span>
  );
}
