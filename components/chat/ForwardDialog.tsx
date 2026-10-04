/**
 * components/chat/ForwardDialog.tsx — pick a conversation to forward into.
 *
 * The forward travels over the socket (`message:send` with `forwardedFromId`),
 * NOT over REST, because that is the only path that fans the new message out to
 * the target room live. The server re-checks that the sender can read the
 * source message, so this dialog does not have to be trusted.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, Button, Dialog, Icon, Input, Skeleton, toast } from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { apiGet } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-client";
import { conversationDisplayName } from "@/lib/chat";
import { useSocket } from "@/lib/realtime/client";
import { ClientToServer } from "@/lib/realtime/events";
import type { ChatMessage, ConversationView, Paginated } from "@/lib/types";

interface ForwardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The message being forwarded. */
  message: ChatMessage | null;
  /** The conversation the message came from — excluded from the target list. */
  currentConversationId: string;
}

export function ForwardDialog({
  open,
  onOpenChange,
  message,
  currentConversationId,
}: ForwardDialogProps) {
  const { socket } = useSocket();
  const { user } = useAuth();
  // Required: a DM's display name is "the member who is not me".
  const selfId = user?.id ?? "";
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<Paginated<ConversationView>>("/api/conversations", {
        params: { limit: 50 },
      });
      setConversations(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your conversations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // No state reset here on purpose: the parent mounts this dialog with a
    // `key` derived from the message being forwarded, so opening it for a new
    // message remounts the component with fresh state instead of clearing it
    // inside an effect (which would cascade a second render).
    void load();
  }, [open, load]);

  // The current thread is not a useful forward target — it is already there.
  const targets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations
      .filter((c) => c.id !== currentConversationId)
      .filter((c) => {
        if (!q) return true;
        const name = conversationDisplayName(c, selfId).toLowerCase();
        return name.includes(q);
      });
  }, [conversations, query, currentConversationId, selfId]);

  // `useCallback` for two reasons: the id below is generated with `Date.now()`
  // and `Math.random()`, which are impure — React's purity rule only allows
  // them inside a callback/effect, not in the render path — and the handler
  // stays referentially stable for the list rows.
  const forwardTo = useCallback(
    (target: ConversationView) => {
    if (!message || !socket || sendingTo) return;
    setSendingTo(target.id);
    const clientId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    socket.emit(
      ClientToServer.MESSAGE_SEND,
      {
        conversationId: target.id,
        clientId,
        body: message.body ?? undefined,
        // SYSTEM is not a sendable type — degrade rather than reject.
        type: message.type === "SYSTEM" ? "TEXT" : message.type,
        forwardedFromId: message.id,
        // The server re-creates these attachment rows against the same URLs,
        // so no bytes are re-uploaded. `id` is dropped: the socket schema
        // assigns fresh ids on persist.
        attachments: message.attachments.map((a) => ({
          kind: a.kind,
          url: a.url,
          name: a.name,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          width: a.width,
          height: a.height,
        })),
      },
      (res?: { ok?: boolean; code?: string }) => {
        setSendingTo(null);
        if (res?.ok) {
          toast({
            variant: "success",
            title: `Forwarded to ${conversationDisplayName(target, selfId)}`,
          });
          onOpenChange(false);
        } else {
          toast({
            variant: "error",
            title:
              res?.code === "EMAIL_UNVERIFIED"
                ? "Verify your email before sending messages."
                : "Could not forward. Please try again.",
          });
        }
      },
    );
    },
    [message, socket, sendingTo, onOpenChange, selfId],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Forward message"
      description="Choose a conversation. The original stays where it is."
    >
      <div className="flex flex-col gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
          autoFocus
        />

        {loading ? (
          <div className="flex flex-col gap-2" aria-busy>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5">
            <p className="text-body-sm font-medium text-danger-strong">{error}</p>
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : targets.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-body-sm text-ink-2">
            {conversations.length <= 1
              ? "You need another conversation before you can forward."
              : "No conversation matches that search."}
          </p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto" role="list">
            {targets.map((c) => {
              const name = conversationDisplayName(c, selfId);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => forwardTo(c)}
                    disabled={sendingTo !== null}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                      "hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60",
                    )}
                  >
                    <Avatar src={c.avatarUrl} name={name} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm font-medium text-ink">{name}</span>
                      <span className="block truncate text-caption text-ink-3">
                        {c.type === "GROUP" ? `${c.members.length} members` : "Direct message"}
                      </span>
                    </span>
                    {sendingTo === c.id ? (
                      <Icon name="clock" size={16} aria-label="Forwarding" className="text-ink-3" />
                    ) : (
                      <Icon name="chevronRight" size={16} aria-hidden className="text-ink-3" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
