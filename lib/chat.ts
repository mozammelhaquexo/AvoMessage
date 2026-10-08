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
      clientId: c.clientId,
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
    // An optimistic message carries `author: null`, so it arrives here (the
    // socket branch) rather than the REST branch. Both branches have to keep
    // `clientId`, or the stable key disappears exactly when it is needed.
    clientId: (m as { clientId?: string }).clientId,
  };
}

/* ── Ownership ─────────────────────────────────────────────────────────── */

/**
 * Did the viewer send this message?
 *
 * Deliberately not `senderId === selfId`. An optimistic message is written
 * locally before the server has seen it, so its `senderId` is `null` — judging
 * it by `senderId` alone made the bubble render on the LEFT for the moment
 * before the reply arrived and then jump to the right when the persisted row
 * replaced it. That jump is the bug being fixed here.
 *
 * `pending` is set in exactly one place — `useConversation.sendMessage`, on the
 * message this client just composed — so it is proof of ownership by itself.
 * The `senderId` comparison is kept for everything else, unchanged.
 */
export function isOwnMessage(
  message: Pick<ChatMessage, "senderId" | "pending">,
  selfId: string | null | undefined,
): boolean {
  if (message.pending) return true;
  return message.senderId === selfId;
}

/**
 * The React key for a message row.
 *
 * Stable across the optimistic → persisted swap: the server assigns a new `id`
 * but the client's own `clientId` rides along, so keying on it turns the swap
 * into an update instead of a remount. Keyed on `id`, React unmounted and
 * remounted the bubble, replaying the entrance animation — the second half of
 * the "message jumps" report.
 */
export function messageKey(message: Pick<ChatMessage, "id" | "clientId">): string {
  return message.clientId ?? message.id;
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
  convo: {
    type: string;
    title: string | null;
    members: { user: { id: string; name: string }; displayName?: string }[];
  },
  selfId: string,
): string {
  if (convo.type === "GROUP") return convo.title ?? "Group chat";
  const other = convo.members.find((m) => m.user.id !== selfId);
  /*
   * `displayName` is the server's resolved name — the viewer's private
   * nickname, then the member's own group nickname, then the real name. It is
   * OPTIONAL because this helper is also called with bare member lists (and is
   * unit-tested that way), so `user.name` remains the fallback rather than a
   * second code path.
   */
  return other?.displayName ?? other?.user.name ?? "Direct message";
}

export function otherMember(
  members: { user: { id: string } }[],
  selfId: string,
): (typeof members)[number] | undefined {
  return members.find((m) => m.user.id !== selfId);
}

/**
 * What to call ONE person inside a thread — the bubble byline, the quoted
 * reply's author, the composer's "Replying to …".
 *
 * This is the same rule as `conversationDisplayName`, one level down, and it
 * has to live in one place for the same reason: a group nickname that appears
 * in the member drawer but not above the person's own messages is worse than no
 * nickname at all — the user sets it, sees it in the list, and then watches
 * somebody's real name arrive with every message.
 *
 * `displayName` is OPTIONAL because the member list is not always to hand:
 *
 *   - a message loaded from `GET …/messages` is joined against
 *     `GET /api/conversations/:id`, which the chat window holds — so the
 *     resolved name IS available for every bubble in the open thread;
 *   - a live `message:new` carries only `author.name` (see the note on
 *     `QuoteBlock`), and a thread whose member list has not arrived yet has
 *     nothing to resolve against.
 *
 * In both of those cases the real name is the honest answer, so `fallback` is
 * returned rather than an empty string or a placeholder.
 */
export function memberDisplayName(
  members: { user: { id: string; name: string }; displayName?: string }[],
  userId: string | null | undefined,
  fallback?: string | null,
): string | null {
  if (!userId) return fallback ?? null;
  const member = members.find((m) => m.user.id === userId);
  return member?.displayName ?? member?.user.name ?? fallback ?? null;
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
