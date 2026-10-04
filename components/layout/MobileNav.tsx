/**
 * components/layout/MobileNav.tsx — bottom tab bar for <lg screens.
 * Home, Messages, Notifications, Companies + a center Create button.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { formatCount } from "@/lib/format";
import { useComposer } from "./composer-context";

interface MobileNavProps {
  notificationUnread: number;
  messageUnread: number;
}

export function MobileNav({ notificationUnread, messageUnread }: MobileNavProps) {
  const pathname = usePathname();
  const { openComposer } = useComposer();

  const tabs: { href: string; label: string; icon: IconName; match: (p: string) => boolean; badge?: number }[] = [
    { href: "/home", label: "Home", icon: "home", match: (p) => p === "/home" || p.startsWith("/post/") },
    { href: "/messages", label: "Messages", icon: "message", match: (p) => p.startsWith("/messages"), badge: messageUnread },
    { href: "/notifications", label: "Notifications", icon: "bell", match: (p) => p.startsWith("/notifications"), badge: notificationUnread },
    { href: "/companies", label: "Companies", icon: "building", match: (p) => p.startsWith("/compan") || p.startsWith("/company/") },
  ];

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-sticky border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      {/* 5 tracks: 2 tabs · centre Create · 2 tabs. The column count must match
          the rendered child count or the Create button sits off-centre and a
          blank strip appears on the right. */}
      <ul className="grid grid-cols-5 items-stretch">
        {tabs.slice(0, 2).map((tab) => (
          <Tab key={tab.label} {...tab} active={tab.match(pathname)} />
        ))}
        {/* Center create button */}
        <li className="flex items-stretch justify-center">
          <button
            type="button"
            onClick={openComposer}
            aria-label="Create post"
            className="my-1.5 flex w-14 items-center justify-center rounded-2xl bg-brand-cta text-on-brand shadow-pop transition-transform active:scale-95"
          >
            <Icon name="plus" size={24} />
          </button>
        </li>
        {tabs.slice(2).map((tab) => (
          <Tab key={tab.label} {...tab} active={tab.match(pathname)} />
        ))}
      </ul>
    </nav>
  );
}

function Tab({
  href,
  label,
  icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: IconName;
  active: boolean;
  badge?: number;
}) {
  return (
    <li className="flex items-stretch">
      <Link
        href={href}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex min-h-16 w-full flex-col items-center justify-center gap-0.5 transition-colors duration-fast",
          active ? "text-brand-strong" : "text-ink-3 hover:text-ink-2",
        )}
      >
        <Icon name={icon} size={24} />
        <span className="text-tiny font-medium">{label}</span>
        {badge !== undefined && badge > 0 && (
          <span
            aria-label={`${badge} unread`}
            className="absolute top-1.5 right-1/2 flex h-4 min-w-4 translate-x-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-on-brand"
          >
            {formatCount(badge)}
          </span>
        )}
        {active && (
          <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-brand" />
        )}
      </Link>
    </li>
  );
}
