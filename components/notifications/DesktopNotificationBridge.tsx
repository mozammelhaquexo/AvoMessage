/**
 * components/notifications/DesktopNotificationBridge.tsx — turns realtime
 * events into real OS notifications (Windows Action Center, macOS Notification
 * Center).
 *
 * Mounted once, inside `SocketProvider` (see AppShell). It is deliberately
 * invisible and renders nothing.
 *
 * THE TWO SOURCES, AND WHY BOTH ARE NEEDED
 *
 *   1. `notification:new` — likes, comments, follows, mentions, invitations,
 *      manager-application decisions, and messages that arrived while the user
 *      was offline (the socket server only writes a MESSAGE row for an
 *      offline/muted recipient). Straightforward: the payload already carries
 *      the title, the body and the routable entity id.
 *
 *   2. `conversation:updated` with a RISING `unreadCount` — a message that
 *      arrived while the user was online. This is the only signal that exists
 *      for a thread the user does not have open: the server does not create a
 *      Notification row for an online recipient, and on the polling transport
 *      (`lib/realtime/polling.ts`) `message:new` is only ever emitted for
 *      conversations the client has joined. Without this second source, "I was
 *      on another tab and never saw the message" would be the default
 *      experience — which is exactly the complaint this feature answers.
 *
 *      The payload carries only ids, so the preview is resolved with one
 *      `GET /api/conversations/:id`, cached briefly per conversation. The
 *      notification is tagged by conversation, so a burst of messages collapses
 *      into one notification rather than stacking — the same behaviour as
 *      WhatsApp Web.
 *
 * DEDUPLICATION
 * A message can be announced by both sources within one poll interval. Every
 * handled `messageId` is remembered, and a `message:new` for a conversation
 * also records the id so the later `conversation:updated` stays quiet.
 *
 * PERMISSION
 * Never requested here. `Notification.requestPermission()` needs a user
 * gesture, and a bridge that fires one on mount is both blocked by the browser
 * and obnoxious. The two gestures live in the UI: the toggle in
 * Settings → Notifications, and the prompt in the notification centre.
 */
"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRealtimeEvent } from "@/lib/realtime/client";
import { ServerToClient, type NotificationPayload } from "@/lib/realtime/events";
import { useSession } from "@/lib/auth-client";
import { apiGet } from "@/lib/api-client";
import { conversationDisplayName } from "@/lib/chat";
import { OPEN_NOTIFICATION_EVENT, show } from "@/lib/desktop-notifications";

/** How long a resolved conversation preview is reused, in ms. */
const PREVIEW_TTL_MS = 15_000;
/** Cap on remembered message ids — a long session must not grow unbounded. */
const SEEN_LIMIT = 500;

interface ConversationPreview {
  id: string;
  type: string;
  title: string | null;
  members: { user: { id: string; name: string } }[];
  lastMessage: { body: string | null; senderId: string | null } | null;
}

/** In-app target for a notification payload, or "" when there is none. */
function notificationHref(n: NotificationPayload): string {
  const id = n.entityId;
  switch (n.entityType) {
    case "post":
      return id ? `/post/${id}` : "";
    case "conversation":
    case "message":
      return id ? `/messages/${id}` : "/messages";
    case "user":
      return n.actor ? `/profile/${n.actor.username}` : "";
    case "manager_application":
      return "/settings?tab=manager";
    case "company":
    case "team":
    case "invitation":
      return "/companies";
    default:
      return "";
  }
}

export function DesktopNotificationBridge() {
  const router = useRouter();
  const { user } = useSession();
  const selfId = user?.id ?? "";

  const seenMessages = useRef(new Set<string>());
  const unreadByConversation = useRef(new Map<string, number>());
  const previews = useRef(new Map<string, { at: number; name: string; body: string }>());
  const resolving = useRef(new Set<string>());

  /** Remember an id, keeping the set bounded (oldest insertion dropped first). */
  const remember = useCallback((id: string) => {
    const set = seenMessages.current;
    if (set.has(id)) return;
    set.add(id);
    if (set.size > SEEN_LIMIT) {
      const oldest = set.values().next().value;
      if (typeof oldest === "string") set.delete(oldest);
    }
  }, []);

  /* ── Notification click → in-app navigation ─────────────────────────── */
  useEffect(() => {
    const onOpen = (event: Event) => {
      const href = (event as CustomEvent<{ href?: string }>).detail?.href;
      if (href) router.push(href);
    };
    window.addEventListener(OPEN_NOTIFICATION_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_NOTIFICATION_EVENT, onOpen);
  }, [router]);

  /* ── Source 1: a real notification row ──────────────────────────────── */
  useRealtimeEvent(ServerToClient.NOTIFICATION_NEW, (payload: NotificationPayload) => {
    if (!payload || typeof payload.id !== "string") return;
    show({
      title: payload.title ?? payload.actor?.name ?? "AvoMessage",
      body: payload.body ?? undefined,
      tag: `avo-notif:${payload.id}`,
      href: notificationHref(payload),
    });
  });

  /* ── Source 2a: a message in the thread the user has open ───────────── */
  useRealtimeEvent(
    ServerToClient.MESSAGE_NEW,
    (payload: { message?: { id: string; conversationId: string; senderId: string | null; body: string | null; author: { name: string } | null } }) => {
      const message = payload?.message;
      if (!message?.id) return;
      remember(message.id);
      if (selfId && message.senderId === selfId) return;
      show({
        title: message.author?.name ?? "New message",
        body: message.body ?? "Sent an attachment",
        tag: `avo-conv:${message.conversationId}`,
        href: `/messages/${message.conversationId}`,
      });
    },
  );

  /* ── Source 2b: a message in any other thread ───────────────────────── */
  const announceConversation = useCallback(
    async (conversationId: string) => {
      if (resolving.current.has(conversationId)) return;

      const cached = previews.current.get(conversationId);
      let name: string;
      let body: string;
      if (cached && Date.now() - cached.at < PREVIEW_TTL_MS) {
        name = cached.name;
        body = cached.body;
      } else {
        resolving.current.add(conversationId);
        try {
          const convo = await apiGet<ConversationPreview>(
            `/api/conversations/${encodeURIComponent(conversationId)}`,
          );
          name = conversationDisplayName(convo, selfId);
          body = convo.lastMessage?.body ?? "Sent an attachment";
          previews.current.set(conversationId, { at: Date.now(), name, body });
        } catch {
          // A failed lookup must not lose the notification — the generic
          // wording is still useful, and the click still routes to the thread.
          name = "New message";
          body = "Open AvoMessage to read it.";
        } finally {
          resolving.current.delete(conversationId);
        }
      }

      show({
        title: name,
        body,
        tag: `avo-conv:${conversationId}`,
        href: `/messages/${conversationId}`,
      });
    },
    [selfId],
  );

  useRealtimeEvent(
    ServerToClient.CONVERSATION_UPDATED,
    (payload: { conversationId?: string; unreadCount?: number; messageId?: string }) => {
      const conversationId = payload?.conversationId;
      if (!conversationId || typeof payload.unreadCount !== "number") return;

      const previous = unreadByConversation.current.get(conversationId);
      unreadByConversation.current.set(conversationId, payload.unreadCount);

      // First sighting of a conversation is a baseline, not an arrival — the
      // same rule the transport itself uses for its own diffs.
      if (previous === undefined) return;
      if (payload.unreadCount <= previous) return;

      if (payload.messageId) {
        if (seenMessages.current.has(payload.messageId)) return;
        remember(payload.messageId);
      }

      void announceConversation(conversationId);
    },
  );

  return null;
}
