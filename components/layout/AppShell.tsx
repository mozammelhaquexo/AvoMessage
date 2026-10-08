/**
 * components/layout/AppShell.tsx — authenticated app chrome.
 *
 * Owned by Frontend Engineer A.
 *
 * Desktop: fixed left sidebar + centered content + right utility rail (xl+).
 * Mobile: slim top bar + bottom tab bar; content gets bottom padding so the
 * tab bar never covers it.
 *
 * Also owns: presence heartbeat, notification/message unread badges,
 * the unverified-email banner, and the global "Create post" composer dialog.
 */
"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SocketProvider,
  useNotifications,
  usePublishPresence,
  useRealtimeEvent,
} from "@/lib/realtime/client";
import { ServerToClient } from "@/lib/realtime/events";
import { useSession } from "@/lib/auth-client";
import { apiGet, apiPatch, apiPost, uploadFile, ApiError } from "@/lib/api-client";
import { hasPendingAvatar, takePendingAvatar } from "@/lib/pending-avatar";
import { Button, Icon, toast } from "@/components/ui";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { TopBar } from "./TopBar";
import { RightPanel } from "./RightPanel";
import { ComposerProvider } from "./composer-context";
import { PostComposer } from "@/components/posts/PostComposer";
import { DesktopNotificationBridge } from "@/components/notifications/DesktopNotificationBridge";
import { PushSubscriptionBridge } from "@/components/notifications/PushSubscriptionBridge";

interface ConversationListItem {
  id: string;
  unreadCount?: number;
}

function UnverifiedBanner() {
  const { user, refresh } = useSession();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!user || user.emailVerified) return null;

  const resend = async () => {
    setSending(true);
    try {
      await apiPost("/api/auth/resend-verification", {});
      setSent(true);
      toast({ title: "Verification email sent", description: "Check your inbox for the link." });
      void refresh();
    } catch (e) {
      const message =
        e instanceof ApiError && e.code === "RATE_LIMITED"
          ? "Please wait a minute before requesting another email."
          : "Could not send the email. Please try again.";
      toast({ title: "Couldn't send email", description: message, variant: "error" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2.5"
    >
      <Icon name="alert" size={18} className="shrink-0 text-warning-strong" />
      <p className="min-w-0 flex-1 text-body-sm text-ink">
        <span className="font-semibold">Verify your email</span> to post, comment, and message.{" "}
        <span className="text-ink-2">We sent a link to {user.email}.</span>
      </p>
      <Button size="sm" variant="outline" loading={sending} onClick={() => void resend()}>
        {sent ? "Sent" : "Resend"}
      </Button>
    </div>
  );
}

function ShellChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useSession();
  const { unreadCount, seed } = useNotifications();

  usePublishPresence(user ? "ONLINE" : null);

  // Seed the notification badge from the REST list (unreadCount is included).
  useEffect(() => {
    let cancelled = false;
    apiGet<{ data: unknown[]; unreadCount: number }>("/api/notifications", { params: { limit: 1 } })
      .then((res) => {
        if (!cancelled) seed([], res.unreadCount);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [seed]);

  // Safety net for a signup avatar: if the verify-email page didn't get a
  // chance to upload the stashed file (e.g. the tab was closed), apply it
  // here once the user is verified.
  useEffect(() => {
    if (!user?.emailVerified || !hasPendingAvatar()) return;
    let cancelled = false;
    (async () => {
      const file = takePendingAvatar();
      if (!file) return;
      try {
        const uploaded = await uploadFile("avatar", file);
        if (!cancelled) await apiPatch("/api/users/me", { avatarUrl: uploaded.url });
      } catch {
        /* avatar is optional — never break the shell */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.emailVerified]);

  // ── Message unread badge ──────────────────────────────────────────────
  const [unreadByConvo, setUnreadByConvo] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    apiGet<ConversationListItem[] | { data: ConversationListItem[] }>("/api/conversations", {
      params: { limit: 50 },
    })
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res) ? res : res.data;
        const map: Record<string, number> = {};
        for (const c of list) {
          if (c.unreadCount) map[c.id] = c.unreadCount;
        }
        setUnreadByConvo(map);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useRealtimeEvent(
    ServerToClient.CONVERSATION_UPDATED,
    (payload: { conversationId: string; unreadCount?: number }) => {
      if (!payload?.conversationId) return;
      setUnreadByConvo((prev) => ({
        ...prev,
        [payload.conversationId]: payload.unreadCount ?? 0,
      }));
    },
  );

  // Clear the badge once the user actually opens their inbox.
  useEffect(() => {
    if (pathname.startsWith("/messages")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset badge on navigation
      setUnreadByConvo({});
    }
  }, [pathname]);

  const messageUnread = useMemo(
    () => Object.values(unreadByConvo).reduce((sum, n) => sum + n, 0),
    [unreadByConvo],
  );

  const onPostCreated = useCallback(() => {
    // Feeds listen for this to prepend the new post without a refetch.
    window.dispatchEvent(new CustomEvent("avo:post-created"));
  }, []);

  // The right utility rail (search + trending) shows on the Home feed only.
  const showRightPanel = pathname === "/home";

  return (
    <ComposerProvider>
      <div className="min-h-dvh bg-canvas text-ink">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-tooltip focus:rounded-md focus:bg-brand-cta focus:px-4 focus:py-2 focus:text-on-brand"
        >
          Skip to content
        </a>
        <Sidebar notificationUnread={unreadCount} messageUnread={messageUnread} />
        <div className="lg:pl-72">
          <TopBar />
          <UnverifiedBanner />
          <div className="mx-auto flex w-full max-w-[1440px] items-start gap-6 px-0 sm:px-4 lg:px-6">
            <main id="main-content" className="min-w-0 flex-1 pb-24 pt-0 sm:pt-4 lg:pb-12" tabIndex={-1}>
              {children}
            </main>
            {showRightPanel && (
              <div className="ml-auto pt-4">
                <RightPanel />
              </div>
            )}
          </div>
        </div>
        <MobileNav notificationUnread={unreadCount} messageUnread={messageUnread} />
        <PostComposer global onPosted={onPostCreated} />
        {/* Renders nothing; turns realtime events into OS notifications. Must
            live inside SocketProvider, which AppShell provides. */}
        <DesktopNotificationBridge />
        {/* Renders nothing; re-registers this browser's push endpoint so the
            server can reach it with the tab CLOSED. */}
        <PushSubscriptionBridge />
      </div>
    </ComposerProvider>
  );
}

/**
 * AppShell — wrap authenticated pages with this (inside (app)/layout.tsx,
 * which already provides AuthProvider). Mounts the socket connection,
 * presence heartbeat, badges, and navigation chrome.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SocketProvider>
      <ShellChrome>{children}</ShellChrome>
    </SocketProvider>
  );
}

/** Re-exported for pages that need a back-link pattern. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-body-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <Icon name="chevronLeft" size={18} />
      {label}
    </Link>
  );
}
