/**
 * components/chat/ConversationMemberManager.tsx — group member management
 * drawer content: list members with roles, add via search (admins), remove
 * (admins), used inside ChatWindow's member drawer.
 *
 * Extracted from ChatWindow.tsx (code-review split; no behavior change).
 */
"use client";

import { useEffect, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  Icon,
  Input,
  toast,
} from "@/components/ui";
import { apiDelete, apiGet, apiPost } from "@/lib/api-client";
import { formatRelative } from "@/lib/chat";
import type {
  ConversationView,
  Paginated,
  PublicUser,
} from "@/lib/types";

export function ConversationMemberManager({
  conversationId,
  members,
  canManage,
  selfId,
  onChanged,
}: {
  conversationId: string;
  members: ConversationView["members"];
  canManage: boolean;
  selfId: string;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<PublicUser | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      apiGet<Paginated<PublicUser>>("/api/search", { params: { q: query.trim(), type: "users", limit: 8 } })
        .then((res) => setResults(res.data.filter((u) => !members.some((m) => m.user.id === u.id))))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query, members]);

  async function add(userId: string) {
    setBusy(userId);
    try {
      await apiPost(`/api/conversations/${conversationId}/members`, { userIds: [userId] });
      setQuery("");
      setResults([]);
      onChanged();
      toast({ variant: "success", title: "Member added" });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not add member" });
    } finally {
      setBusy(null);
    }
  }

  async function remove(userId: string) {
    setBusy(userId);
    try {
      await apiDelete(`/api/conversations/${conversationId}/members/${userId}`);
      onChanged();
      toast({ variant: "success", title: "Member removed" });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not remove member" });
    } finally {
      setBusy(null);
      setConfirmRemove(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-caption font-semibold uppercase tracking-wider text-ink-3">
          {members.length} member{members.length === 1 ? "" : "s"}
        </p>
        <ul className="flex flex-col gap-1">
          {members.map((m) => (
            <li key={m.user.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2">
              <Avatar src={m.user.avatarUrl} name={m.user.name} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-medium text-ink">
                  {m.user.name}
                  {m.user.id === selfId && <span className="text-ink-3"> (you)</span>}
                </span>
                <span className="block text-caption text-ink-3">@{m.user.username} · joined {formatRelative(m.joinedAt)}</span>
              </span>
              {m.role !== "MEMBER" && (
                <Badge variant="outline" aria-label={`Role: ${m.role}`}>
                  {m.role}
                </Badge>
              )}
              {canManage && m.user.id !== selfId && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setConfirmRemove(m.user)}
                  aria-label={`Remove ${m.user.name}`}
                >
                  <Icon name="x" size={15} aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {canManage && (
        <div>
          <p className="mb-2 text-caption font-semibold uppercase tracking-wider text-ink-3">Add members</p>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people to add"
            aria-label="Search people to add"
          />
          {results.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {results.map((u) => (
                <li key={u.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                  <Avatar src={u.avatarUrl} name={u.name} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-medium text-ink">{u.name}</span>
                    <span className="block truncate text-caption text-ink-3">@{u.username}</span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => void add(u.id)} loading={busy === u.id}>
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmRemove !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRemove(null);
        }}
        title={`Remove ${confirmRemove?.name}?`}
        description="They will no longer see new messages in this conversation."
        confirmLabel="Remove"
        tone="danger"
        icon="user"
        confirming={busy === confirmRemove?.id}
        onConfirm={() => {
          if (confirmRemove) void remove(confirmRemove.id);
        }}
      />
    </div>
  );
}
