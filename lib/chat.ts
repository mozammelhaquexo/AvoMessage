/**
 * lib/chat.ts — shared chat helpers for the messaging UI.
 *
 * - `normalizeMessage`: merges the REST `messageView` shape (sender) and the
 *   socket `MessagePayload` shape (author/senderId) into one `ChatMessage`.
 * - `formatMessageTime` / `formatDayLabel`: timestamps + date dividers.
 * - `renderRichText`: link rendering (URLs + @mentions + #hashtags) returning
 *   React nodes, with HTML-escaping handled by React itself.
 */
import type { ReactNode } from "react";
import type { ChatMessage } from "./types";
import type { MessagePayload } from "./realtime/events";

/* ── Normalization ─────────────────────────────────────────────────────── */

type AnyMessage =
  | (Partial<ChatMessage> & { id: string; conversationId: string })
  | MessagePayload;

function isSocketPayload(m: AnyMessage): m is MessagePayload {
  return "author" in m && typeof (m as MessagePayload).author !== "undefined";
}

/** Bridge REST and socket message shapes into a single ChatMessage. */
export function normalizeMessage(m: AnyMessage): ChatMessage {
  if (!isSocketPayload(m)) {
    const c = m as Partial<ChatMessage> & { id: string; conversationId: string };
    return {
      id: c.id,
      conversationId: c.conversationId,
      senderId: c.senderId ?? c.sender?.id ?? null,
      body: c.body ?? null,
      type: c.type ?? "TEXT",
      createdAt: c.createdAt ?? new Date().toISOString(),
      editedAt: c.editedAt ?? null,
      sender: c.sender ?? null,
      attachments: c.attachments ?? [],
      reactions: c.reactions ?? [],
      voice: c.voice ?? null,
      replyTo: c.replyTo ?? null,
      forwardedFrom: c.forwardedFrom ?? null,
      pending: c.pending,
      failed: c.failed,
      deleted: c.deleted ?? false,
    };
  }
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    body: m.body,
    type: m.type,
    createdAt: m.createdAt,
    editedAt: m.editedAt,
    sender: m.author
      ? {
          ...m.author,
          bio: null,
          isVerified: false,
          // Socket author payloads carry no createdAt; fall back to the
          // message timestamp so the PublicUser shape stays complete.
          // The sender object is display-only (name/avatar/username).
          createdAt: m.createdAt,
        }
      : null,
    attachments: (m.attachments ?? []).map((a) => ({ ...a })),
    reactions: [],
    voice: null,
    // The socket payload now carries an inline preview; fall back to the bare
    // id (older servers / optimistic echoes) so the quote never disappears.
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          sender: null,
          authorName: m.replyTo.authorName,
          body: m.replyTo.body,
          deleted: m.replyTo.deleted,
        }
      : m.replyToId
        ? { id: m.replyToId, sender: null, body: null }
        : null,
    forwardedFrom: m.forwardedFrom
      ? {
          id: m.forwardedFrom.id,
          sender: null,
          authorName: m.forwardedFrom.authorName,
          body: m.forwardedFrom.body,
          deleted: m.forwardedFrom.deleted,
        }
      : null,
    pending: (m as { pending?: boolean }).pending,
    failed: (m as { failed?: boolean }).failed,
    deleted: (m as { deleted?: boolean }).deleted ?? false,
  };
}

/* ── Time formatting ───────────────────────────────────────────────────── */

export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = startOf(now) - startOf(d);
  if (diff === 0) return "Today";
  if (diff === dayMs) return "Yesterday";
  if (diff < 7 * dayMs && diff > 0)
    return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

/** "2024-05-01" day key for grouping date dividers. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.max(0, Math.round(seconds % 60));
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/* ── Rich text (links / mentions / hashtags) ───────────────────────────── */

/**
 * Splits message text into React nodes: URLs become links (target _blank,
 * rel noopener), @mentions and #hashtags become styled spans. Rendering is
 * done with React elements (no dangerouslySetInnerHTML), so text is escaped.
 */
export function renderRichText(
  text: string,
  createElement: (type: "a" | "span", key: string, props: Record<string, unknown>, children: ReactNode) => ReactNode,
): ReactNode[] {
  const pattern = /(https?:\/\/[^\s<>"')\]]+)|(@[a-zA-Z0-9_]{1,30})|(#[a-zA-Z0-9_]{1,50})/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const [token, url, mention, hashtag] = match;
    if (url) {
      nodes.push(
        createElement(
          "a",
          `u${i++}`,
          { href: url, target: "_blank", rel: "noopener noreferrer nofollow", className: "underline underline-offset-2 break-all" },
          token,
        ),
      );
    } else if (mention) {
      nodes.push(
        createElement("span", `m${i++}`, { className: "font-semibold text-brand-strong" }, token),
      );
    } else if (hashtag) {
      nodes.push(
        createElement("span", `h${i++}`, { className: "font-medium text-accent" }, token),
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/* ── Conversation display helpers ──────────────────────────────────────── */

export function conversationDisplayName(
  convo: { type: string; title: string | null; members: { user: { id: string; name: string } }[] },
  selfId: string,
): string {
  if (convo.type === "GROUP") return convo.title ?? "Group chat";
  const other = convo.members.find((m) => m.user.id !== selfId);
  return other?.user.name ?? "Direct message";
}

export function otherMember(
  members: { user: { id: string } }[],
  selfId: string,
): (typeof members)[number] | undefined {
  return members.find((m) => m.user.id !== selfId);
}

/* ── Delivery / seen state ─────────────────────────────────────────────── */

export type SeenState = "none" | "sent" | "seen";

/**
 * Whether the viewer's own most recent message in a conversation has been read
 * by everyone else — the signal behind the green "seen" dot in the list.
 *
 *   "none" — the viewer did not send the last message (or there is none), so
 *            there is nothing of theirs to acknowledge.
 *   "sent" — the viewer sent it and at least one other member has not read it.
 *   "seen" — every other member's `lastReadAt` is at or after the message.
 *
 * Both timestamps are server-assigned (`createdAt` when the message is stored,
 * `lastReadAt` when a member opens the thread), so the comparison never
 * depends on the viewer's clock. A member who joined after the message has a
 * `lastReadAt` equal to their join time, which is correctly treated as read.
 *
 * Deliberately structural rather than taking `ConversationView`, so it can be
 * unit-tested without constructing a whole conversation.
 */
export function seenState(
  convo: {
    members: { user: { id: string }; lastReadAt: string }[];
    lastMessage: { senderId: string | null; createdAt: string } | null;
  },
  selfId: string,
): SeenState {
  const last = convo.lastMessage;
  if (!last || last.senderId !== selfId) return "none";
  const others = convo.members.filter((m) => m.user.id !== selfId);
  if (others.length === 0) return "sent";
  const sentAt = new Date(last.createdAt).getTime();
  if (Number.isNaN(sentAt)) return "none";
  return others.every((m) => new Date(m.lastReadAt).getTime() >= sentAt) ? "seen" : "sent";
}
