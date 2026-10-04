/**
 * components/chat/MessagesView.tsx — shared layout for /messages and
 * /messages/[id]: conversation list pane (desktop) + content pane.
 *
 * Owns the conversation list fetch, mute toggle, and leave/close actions.
 */
"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, EmptyState, toast } from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { apiDelete, apiGet, apiPost } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-client";
import { ConversationList } from "./ConversationList";
import type { ConversationView, Paginated } from "@/lib/types";

interface MessagesViewProps {
  /** When set, the right pane renders `children` (thread) instead of the empty state. */
  children?: ReactNode;
}

export function MessagesView({ children }: MessagesViewProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [leaving, setLeaving] = useState<ConversationView | null>(null);
  const [leavingBusy, setLeavingBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<Paginated<ConversationView>>("/api/conversations", { params: { limit: 50 } });
      setConversations(res.data);
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not load conversations" });
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + refetch whenever refreshKey bumps.
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function toggleMute(id: string, muted: boolean) {
    try {
      await apiPost(`/api/conversations/${id}/mute`, { muted });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not change mute setting" });
    }
  }

  async function leave(id: string) {
    if (!user) return;
    setLeavingBusy(true);
    try {
      await apiDelete(`/api/conversations/${id}/members/${user.id}`);
      setLeaving(null);
      setRefreshKey((k) => k + 1);
      router.replace("/messages");
      toast({ variant: "success", title: "Conversation closed" });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not leave conversation" });
    } finally {
      setLeavingBusy(false);
    }
  }

  return (
    /*
     * Height must exactly consume the viewport minus the app chrome, or the
     * page grows past the viewport and the inner thread scroll produces a
     * second, outer scrollbar. Chrome heights (AppShell + TopBar):
     *   <sm   TopBar 3.5rem + main pb-24 6rem              = 9.5rem
     *   sm–lg TopBar 3.5rem + main pt-4 1rem + pb-24 6rem  = 10.5rem
     *   lg+   TopBar hidden + main pt-4 1rem + pb-12 3rem  = 4rem
     * No `min-h` floor: on short viewports that floor is what caused the
     * double scrollbar.
     */
    <div className="flex h-[calc(100dvh-9.5rem)] sm:h-[calc(100dvh-10.5rem)] lg:h-[calc(100dvh-4rem)]">
      {/* List pane — full width on mobile unless a thread is open */}
      <div
        className={
          children
            ? "hidden w-full shrink-0 border-r border-line bg-surface md:block md:w-80 lg:w-96"
            : "w-full shrink-0 border-r border-line bg-surface md:block md:w-80 lg:w-96"
        }
      >
        <ConversationList
          conversations={conversations}
          loading={loading}
          refreshKey={refreshKey}
          onRefresh={() => setRefreshKey((k) => k + 1)}
          onMuteToggle={toggleMute}
          onLeave={async (id) => {
            const c = conversations.find((x) => x.id === id);
            if (c) setLeaving(c);
          }}
        />
      </div>

      {/* Content pane — hidden on mobile when no thread is open (the list
          takes the full width); the empty state only shows on md+. */}
      <div className={cn("min-w-0 flex-1 bg-canvas", !children && "hidden md:block")}>
        {children ?? (
          <div className="hidden h-full items-center justify-center p-8 md:flex">
            <EmptyState
              icon="message"
              title="Select a conversation"
              description="Choose a conversation from the list, or start a new one."
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={leaving !== null}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
        title="Leave this conversation?"
        description="It will be removed from your list. Group members will see that you left."
        confirmLabel="Leave"
        tone="danger"
        icon="logout"
        confirming={leavingBusy}
        onConfirm={() => {
          if (leaving) void leave(leaving.id);
        }}
      />
    </div>
  );
}
