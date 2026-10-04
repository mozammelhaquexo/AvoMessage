/**
 * components/layout/Sidebar.tsx — desktop left navigation.
 *
 * Nav: Home, Messages, Notifications, Companies, Admin Panel (admins only),
 * Manager Panel (company managers only), Settings, Help/Support.
 * Shows avatar + username + online status, notification badge, unread
 * message badge. The bottom "me" card links to the user's profile.
 * Log out and theme controls live inside Settings.
 */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Avatar, Icon, toPresenceStatus, type IconName } from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { useIsAdmin, useSession } from "@/lib/auth-client";
import { apiGet } from "@/lib/api-client";
import { isCompanyManagerRole } from "@/lib/company-roles";
import { usePresence } from "@/lib/realtime/client";
import { formatCount } from "@/lib/format";

interface SidebarProps {
  notificationUnread: number;
  messageUnread: number;
}

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  match: (path: string) => boolean;
  badge?: number;
  /** Special accent for privileged pages so they stand out as special. */
  accent?: "admin" | "manager";
}

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} unread`}
      className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-tiny font-bold text-on-brand"
    >
      {formatCount(count)}
    </span>
  );
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  const accentIcon =
    item.accent === "admin"
      ? "text-amber-600 group-hover:bg-amber-500/10 dark:text-amber-400"
      : item.accent === "manager"
        ? "text-violet-600 group-hover:bg-violet-500/10 dark:text-violet-400"
        : "text-ink-2 group-hover:bg-surface-2";
  const accentLabel =
    item.accent === "admin"
      ? "font-semibold text-amber-700 dark:text-amber-300"
      : item.accent === "manager"
        ? "font-semibold text-violet-700 dark:text-violet-300"
        : "font-medium text-ink-2";
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 transition-colors duration-fast",
          "hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand",
          active && "bg-surface-2",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-fast",
            active ? "bg-brand-soft text-brand-strong" : accentIcon,
          )}
        >
          <Icon name={item.icon} size={22} />
        </span>
        <span className={cn("text-body-sm", active ? "font-bold text-ink" : accentLabel)}>
          {item.label}
        </span>
        {item.badge !== undefined && <NavBadge count={item.badge} />}
      </Link>
    </li>
  );
}

export function Sidebar({ notificationUnread, messageUnread }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useSession();
  const isAdmin = useIsAdmin();
  const [manageSlug, setManageSlug] = useState<string | null>(null);

  const username = user?.username ?? "";

  // The viewer's own live status. Was hardcoded "online"; now it reflects the
  // real presence row, so choosing Away / Do-not-disturb is actually visible.
  const selfPresence = usePresence(user ? [user.id] : []);
  const selfStatus = toPresenceStatus(selfPresence[user?.id ?? ""]?.status);

  // Companies the viewer can manage (owner/manager role) — for the Manager Panel link.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    apiGet<{ company: { slug: string }; role: string }[]>("/api/companies")
      .then((res) => {
        if (cancelled) return;
        const first = res.find((m) => isCompanyManagerRole(m.role));
        setManageSlug(first?.company.slug ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const items: NavItem[] = [
    { href: "/home", label: "Home", icon: "home", match: (p) => p === "/home" || p.startsWith("/post/") },
    { href: "/messages", label: "Messages", icon: "message", match: (p) => p.startsWith("/messages"), badge: messageUnread },
    { href: "/notifications", label: "Notifications", icon: "bell", match: (p) => p.startsWith("/notifications"), badge: notificationUnread },
    { href: "/companies", label: "Companies", icon: "building", match: (p) => p.startsWith("/compan") || p.startsWith("/company/") },
    { href: "/settings", label: "Settings", icon: "settings", match: (p) => p.startsWith("/settings") },
    { href: "/help", label: "Help & Support", icon: "help", match: (p) => p.startsWith("/help") },
  ];

  // Privileged panels sit in their own section below a divider: Manager above, Admin below.
  const panelItems: NavItem[] = [
    ...(manageSlug
      ? [{ href: `/manage/${manageSlug}`, label: "Manager Panel", icon: "chart" as IconName, match: (p: string) => p.startsWith("/manage/"), accent: "manager" as const }]
      : []),
    ...(isAdmin
      ? [{ href: "/admin", label: "Admin Panel", icon: "shield" as IconName, match: (p: string) => p.startsWith("/admin"), accent: "admin" as const }]
      : []),
  ];

  return (
    <aside
      aria-label="Primary navigation"
      className="fixed inset-y-0 left-0 z-sticky hidden w-72 flex-col border-r border-line bg-surface/80 backdrop-blur-xl lg:flex"
    >
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 px-5">
        <span
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-cta text-on-brand shadow-pop"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
            <path d="M12 2C7 2 3 6.5 3 12c0 2.4.9 4.6 2.3 6.3L3 21l2.8-2.1c1.3.7 2.7 1.1 4.2 1.1h2c5 0 9-4.5 9-10S17 2 12 2Zm0 4.5c.8 0 1.5.7 1.5 1.5S12.8 9.5 12 9.5s-1.5-.7-1.5-1.5.7-1.5 1.5-1.5Zm-3.5 9.2c-.7 0-1.2-.6-1.2-1.2 0-.4.2-.7.5-1-.9-.3-1.6-1.2-1.6-2.3 0-1.4 1.1-2.5 2.5-2.5.8 0 1.5.4 2 1 .5-.6 1.2-1 2-1 1.4 0 2.5 1.1 2.5 2.5 0 1.1-.7 2-1.6 2.3.3.3.5.6.5 1 0 .6-.5 1.2-1.2 1.2-.9 0-1.6-.6-1.9-1.4h-1c-.3.8-1 1.4-1.9 1.4Z" />
          </svg>
        </span>
        <span className="font-display text-h3 font-bold tracking-tight">
          Avo<span className="text-brand-gradient">Message</span>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="Main">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <NavRow key={item.label} item={item} active={item.match(pathname)} />
          ))}
        </ul>
        {panelItems.length > 0 && (
          <>
            <div aria-hidden className="mx-2 my-2.5 border-t border-line" />
            <ul className="flex flex-col gap-0.5" aria-label="Privileged panels">
              {panelItems.map((item) => (
                <NavRow key={item.label} item={item} active={item.match(pathname)} />
              ))}
            </ul>
          </>
        )}
      </nav>

      {/* Me card — links to the viewer's profile */}
      <div className="border-t border-line p-3">
        <Link
          href={`/profile/${username}`}
          className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-2"
        >
          <Avatar src={user?.avatarUrl} name={user?.name ?? "?"} size="md" status={selfStatus} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body-sm font-semibold text-ink">{user?.name}</span>
            <span className="block truncate text-caption text-ink-3">@{username}</span>
          </span>
        </Link>
      </div>
    </aside>
  );
}
