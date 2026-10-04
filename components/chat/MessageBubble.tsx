/**
 * components/chat/MessageBubble.tsx — one chat message.
 *
 * Delivery/read ticks (own messages), emoji reactions (toggle via API),
 * reply / edit (15-min sender window, server-enforced) / delete (tombstone),
 * image/video/file attachments, voice playback, link/mention/hashtag
 * rendering, optimistic pending/failed states.
 */
"use client";

import { createElement, memo, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Avatar,
  Button,
  ConfirmDialog,
  DropdownMenu,
  Icon,
  Input,
  toast,
} from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { apiDelete, apiPatch, apiPost } from "@/lib/api-client";
import { formatMessageTime, renderRichText } from "@/lib/chat";
import { AudioPlayer } from "@/components/voice";
import { tweenFast } from "@/lib/motion";
import type { ChatMessage, ReplyToView } from "@/lib/types";

/** Hand-rolled reaction emoji set (no emoji-picker dependency). */
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "👏", "🔥"];

/** Sender edit/delete window — mirrors the server's 15-minute rule. */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

function formatBytes(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function Ticks({ state }: { state: "pending" | "sent" | "delivered" | "read" | "failed" }) {
  if (state === "pending")
    return (
      <Icon name="clock" size={14} aria-label="Sending" className="text-ink-3" />
    );
  if (state === "failed")
    return <Icon name="alert" size={14} aria-label="Failed to send" className="text-danger" />;
  const read = state === "read";
  // One tick = handed to the server; two = delivered to the recipient;
  // two in brand colour = read. Previously every non-pending state drew two
  // grey ticks, so "sent" was indistinguishable from "delivered".
  const delivered = state === "delivered" || read;
  return (
    <span
      role="img"
      aria-label={read ? "Read" : delivered ? "Delivered" : "Sent"}
      className={cn("flex", read ? "text-brand-strong" : "text-ink-3")}
    >
      <Icon name="check" size={14} aria-hidden />
      {delivered && <Icon name="check" size={14} aria-hidden className="-ml-2" />}
    </span>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  /** Whether the viewer sent this message. */
  own: boolean;
  /** Show the sender's name/avatar (group chats). */
  showSender?: boolean;
  /** True when the previous visible message is from the same sender —
      renders a tighter, visually grouped bubble. */
  grouped?: boolean;
  /** Delivery/read state for own messages. */
  receipt?: "pending" | "sent" | "delivered" | "read" | "failed";
  /** True for messages that arrived live (socket) — these get an entrance
      animation. History messages render instantly for a jank-free open. */
  isNew?: boolean;
  onReply?: (message: ChatMessage) => void;
  onForward?: (message: ChatMessage) => void;
  onRetry?: (id: string) => void;
  /** Called after a successful edit/delete so the parent can update state. */
  onUpdated?: (message: ChatMessage) => void;
  onDeleted?: (id: string) => void;
}

/**
 * The quoted strip above a bubble — used for both a reply's parent and a
 * forward's source. `authorName` is the socket-payload fallback: a live
 * `message:new` carries only the author's name, not a full PublicUser.
 */
function QuoteBlock({ quote, tone }: { quote: ReplyToView; tone: "reply" | "forward" }) {
  const name = quote.sender?.name ?? quote.authorName ?? "Someone";
  return (
    <div
      className={cn(
        "mb-1.5 rounded-md border-l-2 px-2 py-1 text-caption text-ink-2",
        tone === "reply" ? "border-brand bg-surface/60" : "border-accent bg-surface/60",
      )}
    >
      <span className="block font-semibold text-ink-2">{name}</span>
      <span className="line-clamp-2">
        {quote.deleted ? "Message deleted" : quote.body ?? (tone === "forward" ? "Attachment" : "Message")}
      </span>
    </div>
  );
}

function MessageBubbleInner({
  message,
  own,
  showSender = false,
  grouped = false,
  receipt = "sent",
  isNew = false,
  onReply,
  onForward,
  onRetry,
  onUpdated,
  onDeleted,
}: MessageBubbleProps) {
  const [reacting, setReacting] = useState<string | null>(null);
  const [showReactions, setShowReactions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(message.body ?? "");
  const [editBusy, setEditBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Edit/delete are only offered inside the 15-minute window (the server
  // enforces the same). Reading the clock during render is impure and would
  // also freeze the window open, so derive it in an effect and let a timer
  // close it exactly when it expires.
  const canEdit = own && !message.deleted && !message.pending && !message.failed;
  const [editable, setEditable] = useState(false);
  useEffect(() => {
    if (!canEdit) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derive the edit window from the clock
      setEditable(false);
      return;
    }
    const age = Date.now() - new Date(message.createdAt).getTime();
    const remaining = EDIT_WINDOW_MS - age;
    if (remaining <= 0) {
      setEditable(false);
      return;
    }
    setEditable(true);
    const timer = setTimeout(() => setEditable(false), remaining);
    return () => clearTimeout(timer);
  }, [canEdit, message.createdAt]);

  async function toggleReaction(emoji: string) {
    if (reacting) return;
    setReacting(emoji);
    try {
      const has = message.reactions.some((r) => r.emoji === emoji && r.reacted);
      const res = has
        ? await apiDelete<{ reactions: ChatMessage["reactions"] }>(`/api/messages/${message.id}/reactions`, { emoji })
        : await apiPost<{ reactions: ChatMessage["reactions"] }>(`/api/messages/${message.id}/reactions`, { emoji });
      onUpdated?.({ ...message, reactions: res.reactions });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Reaction failed" });
    } finally {
      setReacting(null);
      setShowReactions(false);
    }
  }

  async function saveEdit() {
    const body = editBody.trim();
    if (!body || body === message.body) {
      setEditing(false);
      return;
    }
    setEditBusy(true);
    try {
      const res = await apiPatch<{ body: string; editedAt: string }>(`/api/messages/${message.id}`, { body });
      onUpdated?.({ ...message, body: res.body, editedAt: res.editedAt });
      setEditing(false);
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Edit failed" });
    } finally {
      setEditBusy(false);
    }
  }

  async function doDelete() {
    setDeleteBusy(true);
    try {
      await apiDelete(`/api/messages/${message.id}`);
      onDeleted?.(message.id);
      setConfirmDelete(false);
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Delete failed" });
    } finally {
      setDeleteBusy(false);
    }
  }

  if (message.deleted) {
    return (
      <div className={cn("flex", own ? "justify-end" : "justify-start")}>
        <p className="rounded-lg border border-dashed border-line px-3 py-2 text-caption italic text-ink-3">
          Message deleted
        </p>
      </div>
    );
  }

  const menuItems = [
    ...(onReply ? [{ id: "reply", label: "Reply", icon: "comment" as const, onSelect: () => onReply(message) }] : []),
    ...(onForward ? [{ id: "forward", label: "Forward", icon: "share" as const, onSelect: () => onForward(message) }] : []),
    {
      id: "react",
      label: "React",
      icon: "smile" as const,
      onSelect: () => setShowReactions((v) => !v),
    },
    ...(editable
      ? [{ id: "edit", label: "Edit", icon: "edit" as const, onSelect: () => { setEditBody(message.body ?? ""); setEditing(true); } }]
      : []),
    ...(!message.pending && !message.failed
      ? [{ id: "delete", label: "Delete", icon: "trash" as const, destructive: true, onSelect: () => setConfirmDelete(true) }]
      : []),
  ];

  const bodyNodes: ReactNode[] =
    message.body != null
      ? renderRichText(message.body, (type, key, props, children) =>
          createElement(type, key, props as never, children),
        )
      : [];

  return (
    <motion.div
      initial={isNew ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={tweenFast}
      className={cn("group flex gap-2", own ? "flex-row-reverse" : "flex-row", grouped && "-mt-1")}
      data-message-id={message.id}
    >
      {showSender && !own && (
        <Avatar
          src={message.sender?.avatarUrl ?? null}
          name={message.sender?.name ?? "?"}
          size="sm"
          className={cn("mt-1", grouped && "invisible")}
        />
      )}

      <div className={cn("flex max-w-[75%] flex-col sm:max-w-[65%]", own ? "items-end" : "items-start")}>
        {showSender && !own && message.sender && !grouped && (
          /*
           * A real link, not a coloured span. The accent colour already reads as
           * an affordance, so a dead name is the worst of both worlds: it looks
           * clickable and does nothing. Prefetched like every other profile
           * link, so the profile opens without the loading boundary firing.
           */
          <Link
            href={`/profile/${message.sender.username}`}
            prefetch
            className="mb-0.5 ml-1 w-fit rounded-sm text-caption font-semibold text-accent transition-colors duration-fast hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {message.sender.name}
          </Link>
        )}

        <div className="relative">
          <div
            className={cn(
              "rounded-2xl px-3.5 py-2.5 shadow-sm",
              own
                ? cn("bg-bubble-own text-ink", grouped ? "rounded-br-md" : "rounded-br-lg")
                : cn(
                    "border border-line/60 bg-bubble-their text-ink",
                    grouped ? "rounded-bl-md" : "rounded-bl-lg",
                  ),
              message.failed && "border border-danger/40",
            )}
          >
            {message.forwardedFrom && (
              <div className="mb-1 flex items-center gap-1 text-tiny font-medium text-ink-3">
                <Icon name="share" size={12} aria-hidden />
                Forwarded
              </div>
            )}

            {message.replyTo && <QuoteBlock quote={message.replyTo} tone="reply" />}
            {message.forwardedFrom && <QuoteBlock quote={message.forwardedFrom} tone="forward" />}

            {editing ? (
              <div className="flex min-w-48 flex-col gap-2">
                <Input
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void saveEdit();
                    }
                    if (e.key === "Escape") setEditing(false);
                  }}
                  autoFocus
                  aria-label="Edit message"
                  maxLength={4000}
                />
                <div className="flex justify-end gap-1">
                  <Button size="xs" variant="ghost" onClick={() => setEditing(false)} disabled={editBusy}>
                    Cancel
                  </Button>
                  <Button size="xs" onClick={() => void saveEdit()} loading={editBusy}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {bodyNodes.length > 0 && (
                  <p className="whitespace-pre-wrap break-words text-body-sm leading-relaxed">{bodyNodes}</p>
                )}

                {message.attachments.map((a) => (
                  <AttachmentView key={a.id} kind={a.kind} url={a.url} name={a.name} mimeType={a.mimeType} sizeBytes={a.sizeBytes} />
                ))}

                {message.voice && (
                  <div className="mt-1 max-w-52">
                    <AudioPlayer
                      src={message.voice.url}
                      durationMs={message.voice.durationSeconds * 1000}
                      label={`Voice message from ${message.sender?.name ?? "sender"}`}
                      compact
                    />
                  </div>
                )}

                <div className={cn("mt-1 flex items-center gap-1.5", own ? "justify-end" : "justify-start")}>
                  <time dateTime={message.createdAt} className="text-tiny text-ink-3">
                    {formatMessageTime(message.createdAt)}
                  </time>
                  {message.editedAt && <span className="text-tiny italic text-ink-3">edited</span>}
                  {own && <Ticks state={message.failed ? "failed" : message.pending ? "pending" : receipt} />}
                </div>
              </>
            )}
          </div>

          {/* Hover actions — always visible below md, where there is no hover. */}
          {!message.pending && (
            <div
              className={cn(
                "absolute top-1/2 -translate-y-1/2 transition-opacity focus-within:opacity-100 group-hover:opacity-100",
                "opacity-100 md:opacity-0",
                own ? "-left-10" : "-right-10",
              )}
            >
              <DropdownMenu
                label="Message actions"
                trigger={
                  <button
                    type="button"
                    aria-label="Message actions"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-ink-2 shadow-md hover:text-ink"
                  >
                    <Icon name="dots" size={16} aria-hidden />
                  </button>
                }
                sections={[{ id: "actions", items: menuItems }]}
              />
            </div>
          )}
        </div>

        {/* Reaction picker (hand-rolled) */}
        {showReactions && (
          <div
            role="toolbar"
            aria-label="Add reaction"
            className="mt-1 flex gap-1 rounded-full border border-line bg-surface p-1.5 shadow-md"
          >
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => void toggleReaction(emoji)}
                disabled={reacting === emoji}
                aria-label={`React with ${emoji}`}
                className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition-transform hover:scale-125 disabled:opacity-50"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {/* Reactions */}
        {message.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1" aria-label="Reactions">
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => void toggleReaction(r.emoji)}
                aria-pressed={r.reacted}
                aria-label={`${r.count} reactions of ${r.emoji}${r.reacted ? ", including yours" : ""}`}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption",
                  r.reacted ? "border-brand bg-brand-soft text-brand-strong" : "border-line bg-surface text-ink-2",
                )}
              >
                <span aria-hidden>{r.emoji}</span>
                <span>{r.count}</span>
              </button>
            ))}
          </div>
        )}

        {message.failed && (
          <button
            type="button"
            onClick={() => onRetry?.(message.id)}
            className="mt-1 flex items-center gap-1 text-caption font-medium text-danger-strong hover:underline"
          >
            <Icon name="refresh" size={12} aria-hidden />
            Failed — retry
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete message?"
        description="This message will be removed for everyone. This can't be undone."
        confirmLabel="Delete"
        tone="danger"
        icon="trash"
        confirming={deleteBusy}
        onConfirm={() => void doDelete()}
      />
    </motion.div>
  );
}

/**
 * Memoized: a chat can hold dozens of bubbles; without this, every new
 * message (or receipt update) re-renders the entire history. Props are
 * compared by reference — the parent must pass stable callbacks.
 */
export const MessageBubble = memo(MessageBubbleInner);

function AttachmentView({
  kind,
  url,
  name,
  mimeType,
  sizeBytes,
}: {
  kind: string;
  url: string;
  name: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}) {
  if (kind === "IMAGE") {
    return (
      // Plain <img>: attachment URLs are user content; next/image needs a
      // loader allowlist per host.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={name ?? "Image attachment"} className="img-dim mt-1 max-h-64 rounded-lg object-cover" loading="lazy" />
    );
  }
  if (kind === "VIDEO") {
    return <video src={url} controls preload="metadata" className="mt-1 max-h-64 rounded-lg" aria-label={name ?? "Video attachment"} />;
  }
  if (kind === "VOICE") {
    return (
      <div className="mt-1 max-w-52">
        <AudioPlayer src={url} label={name ?? "Voice message"} compact />
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={name ?? undefined}
      className="mt-1 flex items-center gap-2 rounded-lg bg-surface/60 px-3 py-2 text-body-sm text-ink hover:bg-surface"
    >
      <Icon name="paperclip" size={16} aria-hidden className="shrink-0 text-ink-3" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{name ?? mimeType ?? "File"}</span>
        {sizeBytes != null && <span className="text-caption text-ink-3">{formatBytes(sizeBytes)}</span>}
      </span>
      <Icon name="download" size={14} aria-hidden className="shrink-0 text-ink-3" />
    </a>
  );
}
