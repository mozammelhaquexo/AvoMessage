/**
 * components/chat/ConversationMemberManager.tsx — group settings drawer
 * content: the group photo, your own nickname, the member list with roles, and
 * add/remove (admins).
 *
 * Extracted from ChatWindow.tsx (code-review split; no behavior change).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  Icon,
  Input,
  toast,
} from "@/components/ui";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, apiUpload } from "@/lib/api-client";
import { formatRelative } from "@/lib/chat";
import { NicknameEditor } from "./NicknameEditor";
import type {
  ConversationView,
  Paginated,
  PublicUser,
} from "@/lib/types";

/** Formats the group photo upload accepts — mirrors `UPLOAD_RULES.avatar`. */
const GROUP_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";

export function ConversationMemberManager({
  conversationId,
  title,
  avatarUrl,
  members,
  canManage,
  selfId,
  onChanged,
}: {
  conversationId: string;
  /** The group's name, used for the photo's initials fallback. */
  title: string | null;
  /** The group's current photo, or null. */
  avatarUrl: string | null;
  members: ConversationView["members"];
  canManage: boolean;
  selfId: string;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<PublicUser | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const self = members.find((m) => m.user.id === selfId);

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

  /**
   * Upload the file first, then point the conversation at it.
   *
   * Two steps rather than one multipart request because the conversation PATCH
   * is also how the name is changed; keeping the photo as a URL keeps that
   * endpoint a plain JSON update. The upload is `kind=avatar`, which is the
   * image-only rule set (5MB, jpeg/png/webp, magic-byte checked, SVG refused).
   */
  async function changePhoto(file: File) {
    setPhotoBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "avatar");
      const uploaded = await apiUpload<{ url: string }>("/api/uploads", form);
      await apiPatch(`/api/conversations/${conversationId}`, { avatarUrl: uploaded.url });
      toast({ variant: "success", title: "Group photo updated" });
      onChanged();
    } catch (e) {
      toast({
        variant: "error",
        title: e instanceof Error ? e.message : "Could not update the group photo",
      });
    } finally {
      setPhotoBusy(false);
      // Let the same file be picked again after a failure.
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      await apiPatch(`/api/conversations/${conversationId}`, { avatarUrl: null });
      toast({ variant: "success", title: "Group photo removed" });
      onChanged();
    } catch (e) {
      toast({
        variant: "error",
        title: e instanceof Error ? e.message : "Could not remove the group photo",
      });
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ── Group photo ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Avatar src={avatarUrl} name={title ?? "Group"} size="lg" fallbackIcon="users" />
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-medium text-ink">Group photo</p>
          <p className="mt-0.5 text-caption text-ink-3">
            {canManage
              ? "Everyone in this group sees it. JPG, PNG or WebP, up to 5MB."
              : "Only an admin can change the group photo."}
          </p>
          {canManage && (
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                ref={photoInputRef}
                type="file"
                accept={GROUP_PHOTO_ACCEPT}
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void changePhoto(file);
                }}
              />
              <Button
                size="sm"
                variant="outline"
                loading={photoBusy}
                onClick={() => photoInputRef.current?.click()}
              >
                {avatarUrl ? "Change photo" : "Add photo"}
              </Button>
              {avatarUrl && (
                <Button size="sm" variant="ghost" disabled={photoBusy} onClick={() => void removePhoto()}>
                  Remove
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Your own nickname in this group ─────────────────────────────── */}
      <NicknameEditor
        value={self?.nickname ?? null}
        realName={self?.user.name ?? "Your name"}
        label="Your nickname"
        hint="What the other members see instead of your name. Only in this group."
        onSave={async (nickname) => {
          await apiPut(`/api/conversations/${conversationId}/members/${selfId}/nickname`, {
            nickname,
          });
        }}
        onSaved={onChanged}
      />

      {/* ── Members ─────────────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-caption font-semibold uppercase tracking-wider text-ink-3">
          {members.length} member{members.length === 1 ? "" : "s"}
        </p>
        <ul className="flex flex-col gap-1">
          {members.map((m) => {
            /*
             * `displayName` is resolved by the server (your private nickname →
             * their group nickname → their real name). When it differs from the
             * real name we show the real name too, so it is never a mystery who
             * you are actually talking to.
             */
            const renamed = m.displayName !== m.user.name;
            return (
              <li key={m.user.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                <Avatar src={m.user.avatarUrl} name={m.displayName} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-medium text-ink">
                    {m.displayName}
                    {m.user.id === selfId && <span className="text-ink-3"> (you)</span>}
                    {renamed && (
                      <span className="ml-1 text-caption font-normal text-ink-3">
                        · {m.user.name}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-caption text-ink-3">
                    @{m.user.username} · joined {formatRelative(m.joinedAt)}
                  </span>
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
                    aria-label={`Remove ${m.displayName}`}
                  >
                    <Icon name="x" size={15} aria-hidden />
                  </Button>
                )}
              </li>
            );
          })}
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
