/**
 * components/chat/ChatWindow.tsx — the /messages/[conversationId] thread.
 *
 * REST history (newest-first, reversed for display) + live socket messages
 * merged by id; typing indicator; presence in the header; delivery/read
 * receipts computed from `deliveredBy`/`readState`; date dividers;
 * auto-scroll with a "jump to latest" button; in-thread search; group member
 * drawer (add/remove for admins, leave for anyone).
 */
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { tweenFast } from "@/lib/motion";
import {
  Avatar,
  Button,
  ConfirmDialog,
  Dialog,
  Drawer,
  DropdownMenu,
  EmptyState,
  ErrorState,
  Icon,
  Input,
  Skeleton,
  toast,
} from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-client";
import { useConversation, usePresence, useTyping } from "@/lib/realtime/client";
import { MessageBubble, type NameResolver } from "./MessageBubble";
import { ForwardDialog } from "./ForwardDialog";
import { ConversationMemberManager } from "./ConversationMemberManager";
import { NicknameEditor } from "./NicknameEditor";
import { ChatComposer, type ComposerInput } from "./ChatComposer";
import {
  conversationDisplayName,
  dayKey,
  formatDayLabel,
  isOwnMessage,
  memberDisplayName,
  messageKey,
  normalizeMessage,
} from "@/lib/chat";
import type {
  ChatMessage,
  ConversationView,
  Paginated,
} from "@/lib/types";

const PAGE_SIZE = 50;

export function ChatWindow({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const selfId = user?.id ?? "";

  const [convo, setConvo] = useState<ConversationView | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [nicknameOpen, setNicknameOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [muted, setMuted] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  /** Mirror of `atBottom` for effects that must not re-run on every scroll. */
  const atBottomRef = useRef(true);
  /** Id of the newest message we have already reacted to (auto-scroll / unseen). */
  const lastSeenTailIdRef = useRef<string | null>(null);

  const {
    messages: liveRaw,
    deliveredBy,
    readState,
    sendMessage,
    retryMessage,
    markDelivered,
    markRead,
  } = useConversation(conversationId);
  const { typingUserIds, startTyping, stopTyping } = useTyping(conversationId);

  /* ── Load conversation + history ─────────────────────────────────────── */

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const [c, msgs] = await Promise.all([
        apiGet<ConversationView>(`/api/conversations/${conversationId}`),
        apiGet<Paginated<ChatMessage>>(`/api/conversations/${conversationId}/messages`, {
          params: { limit: PAGE_SIZE },
        }),
      ]);
      setConvo(c);
      setMuted(c.members.find((m) => m.user.id === selfId)?.isMuted ?? false);
      // API is newest-first; display oldest-first.
      setHistory([...msgs.data].reverse().map(normalizeMessage));
      setNextCursor(msgs.nextCursor);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        setForbidden(e.status === 403);
        setError(e.status === 404 ? "This conversation doesn't exist." : null);
      } else {
        setError(e instanceof Error ? e.message : "Could not load the conversation.");
      }
    } finally {
      setLoading(false);
    }
  }, [conversationId, selfId]);

  useEffect(() => {
    setConvo(null);
    setHistory([]);
    setNextCursor(null);
    setReplyTo(null);
    setSearchQuery("");
    setUnseen(0);
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    // Anchor the reading position: prepending older messages grows the
    // scrollHeight, which would otherwise shove the message you were reading
    // off the bottom of the viewport.
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    setLoadingMore(true);
    try {
      const msgs = await apiGet<Paginated<ChatMessage>>(
        `/api/conversations/${conversationId}/messages`,
        { params: { limit: PAGE_SIZE, cursor: nextCursor } },
      );
      setHistory((prev) => [...[...msgs.data].reverse().map(normalizeMessage), ...prev]);
      setNextCursor(msgs.nextCursor);
      requestAnimationFrame(() => {
        const node = scrollRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight - prevHeight + prevTop;
      });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not load older messages" });
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, nextCursor, loadingMore]);

  /* ── Merge history + live ────────────────────────────────────────────── */

  const live = useMemo(() => liveRaw.map(normalizeMessage), [liveRaw]);

  const messages = useMemo(() => {
    const seen = new Set(history.map((m) => m.id));
    const merged = [...history];
    for (const m of live) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        merged.push(m);
      }
    }
    // Optimistic socket messages for this conversation sort by createdAt.
    merged.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return merged;
  }, [history, live]);

  /* ── Read / delivered receipts ───────────────────────────────────────── */

  const otherMemberIds = useMemo(
    () => (convo?.members ?? []).filter((m) => m.user.id !== selfId).map((m) => m.user.id),
    [convo, selfId],
  );

  // Mark incoming messages delivered + read when at the bottom.
  useEffect(() => {
    const incoming = messages.filter((m) => m.senderId && m.senderId !== selfId && !m.pending);
    for (const m of incoming) markDelivered(m.id);
    if (atBottom && incoming.length > 0) {
      const latest = incoming[incoming.length - 1];
      markRead(latest.id);
      apiPost(`/api/conversations/${conversationId}/read`, { messageId: latest.id }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, atBottom, conversationId]);

  function receiptFor(m: ChatMessage): "pending" | "sent" | "delivered" | "read" | "failed" {
    if (m.failed) return "failed";
    if (m.pending) return "pending";
    if (otherMemberIds.length === 0) return "sent";
    const created = new Date(m.createdAt).getTime();
    const read = otherMemberIds.some((id) => {
      const ra = readState[id];
      return ra && new Date(ra).getTime() >= created;
    });
    if (read) return "read";
    const delivered = otherMemberIds.some((id) => (deliveredBy[m.id] ?? []).includes(id));
    return delivered ? "delivered" : "sent";
  }

  /* ── Auto-scroll ─────────────────────────────────────────────────────── */

  function scrollToBottom(smooth = true) {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
    setAtBottom(true);
    atBottomRef.current = true;
    setUnseen(0);
  }

  /**
   * React to a NEW TAIL message only. Keying this off `messages.length` fired
   * on `loadMore` too (which prepends older messages), yanking the reader back
   * to the bottom and inflating the "N new" counter.
   */
  const tailId = messages.length > 0 ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (!tailId || tailId === lastSeenTailIdRef.current) return;
    const isFirstPaint = lastSeenTailIdRef.current === null;
    lastSeenTailIdRef.current = tailId;
    const last = messages[messages.length - 1];
    if (isFirstPaint || last.senderId === selfId || atBottomRef.current) {
      scrollToBottom(false);
    } else {
      setUnseen((n) => n + 1);
    }
    // `messages` is intentionally not a dep — only the tail identity matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tailId, selfId]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = nearBottom;
    setAtBottom(nearBottom);
    if (nearBottom) setUnseen(0);
    if (el.scrollTop < 120 && nextCursor && !loadingMore) void loadMore();
  }

  /* ── Typing + presence ───────────────────────────────────────────────── */

  /*
   * The same resolved name as the byline: "Boss is typing…" must not arrive as
   * "Ada Lovelace is typing…" while the bubble above it says "Boss".
   */
  const typingNames = useMemo(
    () =>
      typingUserIds
        .map((id) => memberDisplayName(convo?.members ?? [], id))
        .filter((n): n is string => !!n),
    [typingUserIds, convo],
  );

  const presence = usePresence(otherMemberIds);
  const dmPartnerId = convo?.type === "DM" ? otherMemberIds[0] : undefined;
  const partnerStatus = dmPartnerId ? presence[dmPartnerId]?.status : undefined;
  const dmPartner = useMemo(
    () => (convo?.type === "DM" ? convo.members.find((m) => m.user.id !== selfId)?.user : undefined),
    [convo, selfId],
  );

  /**
   * The viewer's PRIVATE name for the DM partner, if they set one.
   *
   * Read from the membership rather than from `dmPartner` because a contact
   * nickname is a property of the RELATIONSHIP, not of the person — the same
   * account can be "Rahim" to one colleague and "Rahim (accounts)" to another,
   * and the server has already resolved which one applies to this viewer.
   */
  const dmContactNickname = useMemo(
    () =>
      dmPartner
        ? (convo?.members.find((m) => m.user.id === dmPartner.id)?.contactNickname ?? null)
        : null,
    [convo, dmPartner],
  );

  /**
   * What to call each person in this thread — the byline above their messages,
   * the author line on a quoted reply, and the composer's reply strip.
   *
   * The server resolves `displayName` on every member row (your private
   * nickname → their group nickname → their real name); this turns that list
   * into the lookup the bubbles need. Without it a bubble could only show
   * `sender.name`, so a nickname would appear in the member list and the header
   * and then vanish from the conversation itself — the one place it matters.
   *
   * A `useCallback`, not an inline arrow, because `MessageBubble` is memoized
   * by reference: a fresh function every render would re-render the entire
   * history on every keystroke.
   */
  const nameFor = useCallback<NameResolver>(
    (userId, fallback) => memberDisplayName(convo?.members ?? [], userId, fallback),
    [convo?.members],
  );

  /* ── Search within thread ────────────────────────────────────────────── */

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages.filter((m) => m.body?.toLowerCase().includes(q));
  }, [messages, searchQuery]);

  /* ── Actions ─────────────────────────────────────────────────────────── */

  function handleSend(input: ComposerInput) {
    sendMessage({
      body: input.body,
      type: input.type,
      replyToId: input.replyToId,
      attachments: input.attachments,
    });
    requestAnimationFrame(() => scrollToBottom(false));
  }

  async function toggleMute() {
    try {
      const res = await apiPost<{ muted: boolean }>(`/api/conversations/${conversationId}/mute`, {
        muted: !muted,
      });
      setMuted(res.muted);
      toast({ variant: "success", title: res.muted ? "Conversation muted" : "Conversation unmuted" });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not change mute setting" });
    }
  }

  async function leaveConversation() {
    try {
      await apiDelete(`/api/conversations/${conversationId}/members/${selfId}`);
      toast({ variant: "success", title: "Left the conversation" });
      router.replace("/messages");
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not leave" });
    } finally {
      setConfirmLeave(false);
    }
  }

  const handleUpdated = useCallback((updated: ChatMessage) => {
    setHistory((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  }, []);

  const handleDeleted = useCallback((id: string) => {
    setHistory((prev) =>
      prev.map((m) => (m.id === id ? { ...m, deleted: true, body: null, attachments: [] } : m)),
    );
  }, []);

  const handleRetry = useCallback((id: string) => retryMessage(id), [retryMessage]);

  /**
   * Track which messages arrived live so only they animate in — history
   * messages must render instantly for a jank-free open.
   *
   * "Arrived live" is not the same as "was absent from the history": on the
   * polling transport the first poll after a join announces the whole visible
   * page, which includes messages the REST history already loaded (see
   * `pollMessages` in `lib/realtime/polling.ts`). Subtracting `history` stops
   * those from animating in a second time.
   */
  const liveIds = useMemo(() => {
    const historic = new Set(history.map((m) => m.id));
    return new Set(live.filter((m) => !historic.has(m.id)).map((m) => m.id));
  }, [live, history]);

  /* ── Render ──────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
          <Skeleton variant="circle" className="h-10 w-10" />
          <div className="flex-1">
            <Skeleton className="mb-1 h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-3 overflow-hidden p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className={cn("h-12 w-2/3 rounded-2xl", i % 2 ? "self-end" : "self-start")} />
          ))}
        </div>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <ErrorState
          title="Not authorized"
          message="You don't have access to this conversation. It may have been removed, or you were removed from it."
          onRetry={() => void load()}
        />
      </div>
    );
  }

  if (error || !convo) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <ErrorState title="Couldn't load this chat" message={error ?? undefined} onRetry={() => void load()} />
      </div>
    );
  }

  const name = conversationDisplayName(convo, selfId);
  const isGroup = convo.type === "GROUP";
  const myRole = convo.members.find((m) => m.user.id === selfId)?.role;
  const canManageMembers = isGroup && (myRole === "OWNER" || myRole === "ADMIN");

  let lastDay = "";

  /*
   * The header's name/avatar block is the one place in the thread that leaves
   * the page, so it is a real <Link> rather than a button + router.push().
   *
   * router.push() cannot prefetch. That mattered here: `/profile/[username]` is
   * a client page, so its code chunk had to be fetched on click, and while it
   * was in flight the router fell back to the nearest loading boundary —
   * `app/loading.tsx`, which sits above the app shell and swaps the whole
   * window for a centered spinner. The result was click → whole app vanishes →
   * spinner → profile skeleton → profile.
   *
   * A <Link> prefetches the chunk and the RSC payload while the link is in the
   * viewport, so the boundary never fires and the swap is a single frame. It
   * also restores what a navigational control should do anyway: hover shows the
   * URL, middle-click and ⌘/Ctrl-click open a new tab, and it is announced as a
   * link rather than a button.
   */
  const headerClass =
    "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 text-left transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";
  const headerContent = (
    <>
      <Avatar
        src={isGroup ? convo.avatarUrl : dmPartner?.avatarUrl ?? null}
        name={name}
        size="md"
        status={dmPartnerId ? mapPresence(partnerStatus) : undefined}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-semibold text-ink">{name}</span>
        <span className="block truncate text-caption text-ink-3">
          {isGroup
            ? `${convo.members.length} members`
            : partnerStatus
              ? presenceLabel(partnerStatus)
              : "Direct message"}
        </span>
      </span>
    </>
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2.5 sm:px-4">
        <Button href="/messages" variant="ghost" size="icon-sm" className="md:hidden" aria-label="Back to conversations">
          <Icon name="chevronLeft" size={18} aria-hidden />
        </Button>
        {isGroup ? (
          // A group has no single profile to open, so the block opens the
          // member drawer instead — a real action, hence a button.
          <button
            type="button"
            onClick={() => setMembersOpen(true)}
            className={headerClass}
            aria-label={`View ${name} members`}
          >
            {headerContent}
          </button>
        ) : dmPartner ? (
          <Link
            href={`/profile/${dmPartner.username}`}
            prefetch
            className={headerClass}
            aria-label={`View ${name}'s profile`}
          >
            {headerContent}
          </Link>
        ) : (
          // No partner resolved yet (still loading): show the header, but do
          // not dress it up as something clickable.
          <div className={headerClass}>{headerContent}</div>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setSearchOpen((v) => !v)}
          aria-label="Search in conversation"
          aria-expanded={searchOpen}
        >
          <Icon name="search" size={18} aria-hidden />
        </Button>

        <DropdownMenu
          label="Conversation options"
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label="Conversation options">
              <Icon name="dots" size={18} aria-hidden />
            </Button>
          }
          sections={[
            {
              id: "options",
              items: [
                ...(isGroup
                  ? [
                      {
                        id: "members",
                        // The drawer holds the group photo and your own
                        // nickname as well as the member list, so "Members"
                        // undersold it — and a feature nobody can find is a
                        // feature that does not exist.
                        label: "Group settings",
                        icon: "users" as const,
                        onSelect: () => setMembersOpen(true),
                      },
                    ]
                  : dmPartner
                    ? [
                        {
                          id: "nickname",
                          label: dmContactNickname ? "Change nickname" : "Nickname",
                          icon: "edit" as const,
                          onSelect: () => setNicknameOpen(true),
                        },
                      ]
                    : []),
                { id: "mute", label: muted ? "Unmute" : "Mute", icon: "mute" as const, onSelect: () => void toggleMute() },
                {
                  id: "leave",
                  label: isGroup ? "Leave group" : "Close conversation",
                  icon: "logout" as const,
                  destructive: true,
                  onSelect: () => setConfirmLeave(true),
                },
              ],
            },
          ]}
        />
      </header>

      {/* In-thread search */}
      {searchOpen && (
        <div className="border-b border-line bg-surface px-3 py-2">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages in this conversation"
            aria-label="Search messages"
            autoFocus
          />
          {searchQuery.trim() && (
            <p className="mt-1 px-1 text-caption text-ink-3" role="status">
              {searchResults.length} match{searchResults.length === 1 ? "" : "es"}
            </p>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="chat-thread-bg h-full overflow-y-auto px-3 py-4 sm:px-6"
          role="log"
          aria-label={`Messages in ${name}`}
          aria-live="off"
        >
        {loadingMore && (
          <div className="flex justify-center py-2" role="status">
            <Skeleton className="h-6 w-32 rounded-full" />
          </div>
        )}
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon="message"
              title="No messages yet"
              description={`Say hello to start the conversation${isGroup ? " with the group" : ""}.`}
              compact
            />
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
            {messages.map((m, i) => {
              const day = dayKey(m.createdAt);
              const divider = day !== lastDay;
              lastDay = day;
              const prev = i > 0 ? messages[i - 1] : null;
              // Visually group consecutive messages from the same sender
              // (no date divider between them, neither is deleted).
              const grouped =
                !divider &&
                !!prev &&
                !prev.deleted &&
                !m.deleted &&
                prev.senderId === m.senderId;
              const dimmed =
                searchQuery.trim() !== "" && !m.body?.toLowerCase().includes(searchQuery.trim().toLowerCase());
              return (
                <div key={messageKey(m)}>
                  {divider && (
                    <div className="my-4 flex items-center gap-3" role="separator" aria-label={formatDayLabel(m.createdAt)}>
                      <span className="h-px flex-1 bg-line" aria-hidden />
                      <span className="rounded-full border border-line/60 bg-surface px-3 py-1 text-caption font-medium text-ink-2 shadow-sm">
                        {formatDayLabel(m.createdAt)}
                      </span>
                      <span className="h-px flex-1 bg-line" aria-hidden />
                    </div>
                  )}
                  <div className={cn(dimmed && "opacity-30")}>
                    <MessageBubble
                      message={m}
                      own={isOwnMessage(m, selfId)}
                      showSender={isGroup}
                      nameFor={nameFor}
                      grouped={grouped}
                      /*
                       * Our own optimistic message is new too. `liveIds` only
                       * knows server ids, and a pending row's id is
                       * `pending:<uuid>`, so without the second clause the
                       * message you just sent appeared with no entrance at all
                       * while everybody else's animated in.
                       */
                      isNew={liveIds.has(m.id) || !!m.pending}
                      receipt={isOwnMessage(m, selfId) ? receiptFor(m) : undefined}
                      onReply={setReplyTo}
                      onForward={setForwarding}
                      onRetry={handleRetry}
                      onUpdated={handleUpdated}
                      onDeleted={handleDeleted}
                    />
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <AnimatePresence>
            {!atBottom && (
              <motion.button
                key="jump-latest"
                type="button"
                initial={{ opacity: 0, y: 12, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.9 }}
                transition={tweenFast}
                onClick={() => scrollToBottom()}
                className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-caption font-semibold text-ink shadow-lg hover:bg-surface-2"
              >
                <Icon name="chevronDown" size={14} aria-hidden />
                {unseen > 0 ? `${unseen} new` : "Latest"}
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Typing indicator — floating pill, never shifts layout */}
        <AnimatePresence>
          {typingNames.length > 0 && (
            <motion.div
              key="typing"
              initial={{ opacity: 0, y: 10, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.94 }}
              transition={tweenFast}
              aria-live="polite"
              className="absolute bottom-3 left-3 sm:left-6"
            >
              <div className="flex items-center gap-2.5 rounded-full border border-line/70 bg-surface/95 py-2 pl-3.5 pr-4 shadow-md backdrop-blur">
                <span className="flex gap-1" aria-hidden>
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-ink-3" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-ink-3" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-ink-3" />
                </span>
                <span className="text-caption font-medium text-ink-2">
                  {typingNames.length === 1
                    ? `${typingNames[0]} is typing…`
                    : `${typingNames.slice(0, 2).join(", ")}${typingNames.length > 2 ? ` and ${typingNames.length - 2} more` : ""} are typing…`}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ChatComposer
        onSend={handleSend}
        replyTo={replyTo}
        replyToName={nameFor(replyTo?.sender?.id, replyTo?.sender?.name)}
        onCancelReply={() => setReplyTo(null)}
        onTypingStart={startTyping}
        onTypingStop={stopTyping}
      />

      {/* Member drawer (groups) */}
      <Drawer open={membersOpen} onOpenChange={setMembersOpen} title={`${name} — group settings`}>
        <ConversationMemberManager
          conversationId={conversationId}
          title={convo.title}
          avatarUrl={convo.avatarUrl}
          members={convo.members}
          canManage={!!canManageMembers}
          selfId={selfId}
          onChanged={() => void load()}
        />
      </Drawer>

      {/*
        The DM nickname. A DIALOG rather than an inline field because there is
        nowhere in the thread header to put one without competing with the
        partner's name, and because this is a private label — a modal makes it
        unambiguous that the change is yours alone and is not being announced.
      */}
      <Dialog
        open={nicknameOpen}
        onOpenChange={setNicknameOpen}
        title="Nickname"
        description={
          dmPartner
            ? `Only you will see this. ${dmPartner.name} keeps their real name everywhere else, and is never told.`
            : undefined
        }
      >
        {dmPartner && (
          <NicknameEditor
            value={dmContactNickname}
            realName={dmPartner.name}
            label={`What you call ${dmPartner.name}`}
            hint="Private to you. It is used in this chat, the conversation list and notifications."
            onSave={async (nickname) => {
              // Clearing has its own verb: `DELETE` on the nickname resource.
              // Sending `null` through the PUT would also work, but the two
              // routes existing separately keeps the API self-describing.
              if (nickname === null) {
                await apiDelete(`/api/nicknames/${dmPartner.id}`);
              } else {
                await apiPut("/api/nicknames", { userId: dmPartner.id, nickname });
              }
            }}
            onSaved={() => void load()}
          />
        )}
      </Dialog>

      <ForwardDialog
        // Remount per forwarded message so the dialog always opens with a
        // clean search box and no half-finished send.
        key={forwarding?.id ?? "none"}
        open={forwarding !== null}
        onOpenChange={(open) => {
          if (!open) setForwarding(null);
        }}
        message={forwarding}
        currentConversationId={conversationId}
      />

      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title={isGroup ? "Leave this group?" : "Close this conversation?"}
        description={
          isGroup
            ? "You won't receive new messages from this group unless someone adds you back."
            : "The conversation will be removed from your list."
        }
        confirmLabel={isGroup ? "Leave group" : "Close"}
        tone="danger"
        icon="logout"
        onConfirm={() => void leaveConversation()}
      />
    </div>
  );
}

function mapPresence(status: string | undefined): "online" | "away" | "dnd" | "offline" {
  switch (status) {
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

function presenceLabel(status: string): string {
  switch (status) {
    case "ONLINE":
      return "Online";
    case "AWAY":
      return "Away";
    case "DO_NOT_DISTURB":
      return "Do not disturb";
    default:
      return "Offline";
  }
}
