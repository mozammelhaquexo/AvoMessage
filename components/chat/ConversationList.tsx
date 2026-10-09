/**
 * components/chat/ConversationList.tsx — left pane of /messages.
 *
 * Search (filters the loaded list), unread badges, presence dots on DM
 * avatars, mute/unmute, leave, new DM / new group dialogs. Live list updates
 * arrive via the `conversation:updated` socket event; the parent refreshes
 * the list on it.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DropdownMenu,
  EmptyState,
  Icon,
  Input,
  Skeleton,
  toast,
} from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { apiGet, apiPost } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-client";
import { usePresence, useRealtimeEvent } from "@/lib/realtime/client";
import { ServerToClient } from "@/lib/realtime/events";
import { conversationDisplayName, formatRelative, seenState } from "@/lib/chat";
import { DesktopNotificationPrompt } from "@/components/notifications/DesktopNotificationSetting";
import type { ConversationView, Paginated, PublicUser } from "@/lib/types";

interface ConversationListProps {
  conversations: ConversationView[];
  loading: boolean;
  /** Bump to trigger a refresh from the parent. */
  refreshKey: number;
  onRefresh: () => void;
  onMuteToggle: (id: string, muted: boolean) => Promise<void>;
  onLeave: (id: string) => Promise<void>;
}

export function ConversationList({
  conversations,
  loading,
  refreshKey,
  onRefresh,
  onMuteToggle,
  onLeave,
}: ConversationListProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [newOpen, setNewOpen] = useState<"dm" | "group" | null>(null);

  const activeId = useMemo(() => {
    const m = pathname.match(/^\/messages\/([^/]+)/);
    return m?.[1] ?? null;
  }, [pathname]);

  // Local mute state seeded from memberships.
  useEffect(() => {
    const map: Record<string, boolean> = {};
    for (const c of conversations) {
      const self = c.members.find((m) => m.user.id === user?.id);
      map[c.id] = self?.isMuted ?? false;
    }
    setMuted(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Live: when any conversation updates, ask the parent to refetch.
  useRealtimeEvent(ServerToClient.CONVERSATION_UPDATED, () => onRefresh());

  // Presence for DM partners.
  const dmPartnerIds = useMemo(
    () =>
      conversations
        .filter((c) => c.type === "DM")
        .map((c) => c.members.find((m) => m.user.id !== user?.id)?.user.id)
        .filter((id): id is string => !!id),
    [conversations, user?.id],
  );
  const presence = usePresence(dmPartnerIds);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const name = conversationDisplayName(c, user?.id ?? "").toLowerCase();
      const last = c.lastMessage?.body?.toLowerCase() ?? "";
      return name.includes(q) || last.includes(q);
    });
  }, [conversations, query, user?.id]);

  return (
    <div className="flex h-full flex-col">
      {/* Same permission prompt the notification page uses. Renders only while
          the browser has never been asked (and the user hasn't dismissed it) —
          granted means the prompt has done its job; denied means re-prompting
          would just nag about something only the browser site-settings can fix.
          Lives ABOVE the search row so it never pushes the conversation list
          horizontally when it appears. */}
      <DesktopNotificationPrompt />

      <div className="flex items-center gap-2 p-3">
        <div className="relative flex-1">
          <Icon name="search" size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="pl-9"
          />
        </div>
        <DropdownMenu
          label="New conversation"
          trigger={
            <Button size="icon" aria-label="New conversation">
              <Icon name="plus" size={18} aria-hidden />
            </Button>
          }
          sections={[
            {
              id: "new",
              items: [
                { id: "dm", label: "New direct message", icon: "user", onSelect: () => setNewOpen("dm") },
                { id: "group", label: "New group", icon: "users", onSelect: () => setNewOpen("group") },
              ],
            },
          ]}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4" role="list" aria-label="Conversations">
        {loading ? (
          <div className="flex flex-col gap-2 p-2" aria-label="Loading conversations">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-2">
                <Skeleton variant="circle" className="h-12 w-12" />
                <div className="flex-1">
                  <Skeleton className="mb-1 h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="message"
            title={query ? "No matches" : "No conversations yet"}
            description={query ? "Try a different search." : "Start a direct message or create a group to begin chatting."}
            compact
          />
        ) : (
          filtered.map((c) => {
            const selfId = user?.id ?? "";
            const name = conversationDisplayName(c, selfId);
            const partnerId =
              c.type === "DM" ? c.members.find((m) => m.user.id !== selfId)?.user.id : undefined;
            const status = partnerId ? presence[partnerId]?.status : undefined;
            const isMuted = muted[c.id] ?? false;
            const isActive = c.id === activeId;
            const lastBody =
              c.lastMessage?.deleted ? "Message deleted" : c.lastMessage?.body ?? (c.lastMessage ? "Attachment" : "No messages yet");
            // Green "seen" dot (feature 4): only when the viewer sent the last
            // message and every other member has read it.
            const seen = seenState(c, selfId);

            return (
              <div key={c.id} role="listitem" className={cn("group/item relative rounded-lg", isActive && "bg-brand-soft")}>
                <Link
                  href={`/messages/${c.id}`}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg p-2.5 transition-colors",
                    !isActive && "hover:bg-surface-2",
                  )}
                >
                  <Avatar
                    src={c.type === "DM" ? c.members.find((m) => m.user.id !== selfId)?.user.avatarUrl ?? null : c.avatarUrl}
                    name={name}
                    size="lg"
                    status={status ? mapPresence(status) : undefined}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 truncate text-body-sm font-semibold text-ink">
                        <span className="truncate">{name}</span>
                        {isMuted && <Icon name="mute" size={13} aria-label="Muted" className="shrink-0 text-ink-3" />}
                      </span>
                      {c.lastMessage && (
                        <time dateTime={c.lastMessage.createdAt} className="shrink-0 text-caption text-ink-3">
                          {formatRelative(c.lastMessage.createdAt)}
                        </time>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-body-sm text-ink-2">{lastBody}</p>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {seen === "seen" && (
                          <span
                            role="img"
                            aria-label="Seen by everyone"
                            title="Seen by everyone"
                            className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success text-white"
                          >
                            <Icon name="check" size={9} aria-hidden />
                          </span>
                        )}
                        {c.unreadCount > 0 && !isMuted && (
                          <Badge variant="brand" aria-label={`${c.unreadCount} unread`}>
                            {c.unreadCount > 99 ? "99+" : c.unreadCount}
                          </Badge>
                        )}
                      </span>
                    </div>
                  </div>
                </Link>
                {/* Always visible below md (no hover on touch); hover/focus
                    revealed on desktop. */}
                <div className="absolute right-1 top-1/2 -translate-y-1/2 md:hidden md:group-hover/item:block md:group-focus-within/item:block">
                  <DropdownMenu
                    label={`Actions for ${name}`}
                    trigger={
                      <button
                        type="button"
                        aria-label={`Actions for ${name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-ink-2 shadow-md hover:text-ink"
                      >
                        <Icon name="dots" size={15} aria-hidden />
                      </button>
                    }
                    sections={[
                      {
                        id: "actions",
                        items: [
                          {
                            id: "mute",
                            label: isMuted ? "Unmute" : "Mute",
                            icon: "mute",
                            onSelect: () => {
                              void onMuteToggle(c.id, !isMuted).then(() =>
                                setMuted((m) => ({ ...m, [c.id]: !isMuted })),
                              );
                            },
                          },
                          {
                            id: "leave",
                            label: c.type === "DM" ? "Close" : "Leave group",
                            icon: "logout",
                            destructive: true,
                            onSelect: () => void onLeave(c.id),
                          },
                        ],
                      },
                    ]}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      <NewConversationDialog
        kind={newOpen}
        onClose={() => setNewOpen(null)}
        onCreated={() => {
          setNewOpen(null);
          onRefresh();
        }}
      />
    </div>
  );
}

function mapPresence(status: string): "online" | "away" | "dnd" | "offline" {
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

/* ── New conversation dialog ───────────────────────────────────────────── */

function NewConversationDialog({
  kind,
  onClose,
  onCreated,
}: {
  kind: "dm" | "group" | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[]>([]);
  const [selected, setSelected] = useState<PublicUser[]>([]);
  const [title, setTitle] = useState("");
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!kind) {
      setQuery("");
      setResults([]);
      setSelected([]);
      setTitle("");
    }
  }, [kind]);

  useEffect(() => {
    if (!kind || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      setSearching(true);
      apiGet<Paginated<PublicUser>>("/api/search", { params: { q: query.trim(), type: "users", limit: 10 } })
        .then((res) => setResults(res.data.filter((u) => u.id !== user?.id)))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query, kind, user?.id]);

  function toggleSelect(u: PublicUser) {
    setSelected((prev) => {
      if (kind === "dm") return [u];
      return prev.some((p) => p.id === u.id) ? prev.filter((p) => p.id !== u.id) : [...prev, u];
    });
  }

  async function create() {
    if (selected.length === 0) return;
    if (kind === "group" && !title.trim()) {
      toast({ variant: "warning", title: "Give the group a name" });
      return;
    }
    setCreating(true);
    try {
      const res = await apiPost<{ conversation: { id: string }; created: boolean }>("/api/conversations", {
        type: kind === "dm" ? "DM" : "GROUP",
        userIds: selected.map((u) => u.id),
        ...(kind === "group" ? { title: title.trim() } : {}),
      });
      onCreated(res.conversation.id);
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not create conversation" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog
      open={kind !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={kind === "dm" ? "New direct message" : "New group"}
      size="md"
    >
      <div className="flex flex-col gap-3">
        {kind === "group" && (
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Group name"
            aria-label="Group name"
            maxLength={80}
          />
        )}
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people by name or username"
          aria-label="Search people"
        />
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Selected people">
            {selected.map((u) => (
              <Badge key={u.id} variant="brand">
                {u.name}
                <button
                  type="button"
                  onClick={() => setSelected((p) => p.filter((x) => x.id !== u.id))}
                  aria-label={`Remove ${u.name}`}
                  className="ml-1"
                >
                  <Icon name="x" size={12} aria-hidden />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="max-h-56 overflow-y-auto rounded-lg border border-line" role="listbox" aria-label="People">
          {searching ? (
            <p className="p-4 text-center text-body-sm text-ink-3">Searching…</p>
          ) : results.length === 0 ? (
            <p className="p-4 text-center text-body-sm text-ink-3">
              {query.trim().length < 2 ? "Type at least 2 characters to search." : "No people found."}
            </p>
          ) : (
            results.map((u) => {
              const isSel = selected.some((s) => s.id === u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  onClick={() => toggleSelect(u)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2",
                    isSel && "bg-brand-soft",
                  )}
                >
                  <Avatar src={u.avatarUrl} name={u.name} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-medium text-ink">{u.name}</span>
                    <span className="block truncate text-caption text-ink-3">@{u.username}</span>
                  </span>
                  {isSel && <Icon name="check" size={16} aria-hidden className="text-brand-strong" />}
                </button>
              );
            })
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void create()} loading={creating} disabled={selected.length === 0}>
            {kind === "dm" ? "Message" : "Create group"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
