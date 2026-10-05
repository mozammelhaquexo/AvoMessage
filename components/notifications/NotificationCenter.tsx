/**
 * components/notifications/NotificationCenter.tsx — notification list.
 *
 * Features: paginated list, unread/read styling, mark-one-read, mark-all-read,
 * type filters, unread-only toggle, deep links per notification type, and live
 * updates via useNotifications.
 *
 * FILTERING IS SERVER-SIDE. The filters come from `lib/notification-filters.ts`
 * and are sent as `?type=` / `?unreadOnly=`; the previous version filtered only
 * the rows already paged into the browser, so choosing "Messages" on a feed
 * whose first page was all likes rendered "No notifications" while older
 * message notifications existed.
 *
 * UNREAD COUNT comes from the server (`unreadCount` in the list response) via
 * the shared store in `lib/realtime/client.tsx`, so the header badge and the
 * sidebar badge always show the same number. Recounting the loaded page would
 * cap the badge at one page of results.
 *
 * Deep-link map (entityType values are lowercase per the Prisma schema):
 * - post → /post/:id · user → /profile/:username · conversation → /messages/:id
 * - comment → no post id is exposed by the API (see note below), so these
 *   render without a deep link. BACKEND NOTE: COMMENT/LIKE-on-comment
 *   notifications carry only the comment id; include the post id (or add a
 *   GET /api/comments/:id read endpoint) to enable deep linking.
 * - company/team/invitation → /companies · call → /messages
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  SegmentedControl,
  Skeleton,
  Spinner,
  Switch,
  toast,
  type IconName,
} from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { ScrollNav } from "@/components/ui/ScrollNav";
import { DesktopNotificationPrompt } from "./DesktopNotificationSetting";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { useInfiniteList, useIntersectionObserver } from "@/lib/hooks";
import { useNotifications } from "@/lib/realtime/client";
import { timeAgo } from "@/lib/format";
import {
  NOTIFICATION_FILTERS,
  DEFAULT_NOTIFICATION_FILTER,
  notificationFilterParams,
  notificationMatchesFilter,
  type NotificationFilter,
} from "@/lib/notification-filters";
import type { NotificationItem, NotificationType, Page } from "@/lib/api-types";

const PAGE_SIZE = 20;

/** Response of GET /api/notifications — the list page plus the badge count. */
type NotificationPage = Page<NotificationItem> & { unreadCount: number };

const FILTER_OPTIONS = NOTIFICATION_FILTERS.map((f) => ({ value: f.value, label: f.label }));

const TYPE_ICON: Record<NotificationType, IconName> = {
  LIKE: "heart",
  COMMENT: "comment",
  FOLLOW: "user",
  MENTION: "message",
  MESSAGE: "message",
  CALL_MISSED: "phone",
  INVITATION_RECEIVED: "send",
  INVITATION_ACCEPTED: "check",
  COMPANY_ROLE_CHANGED: "building",
  TEAM_ADDED: "users",
  REPORT_STATUS: "flag",
  SYSTEM: "info",
};

const TYPE_TONE: Record<NotificationType, string> = {
  LIKE: "bg-danger/10 text-danger",
  COMMENT: "bg-info/10 text-info-strong",
  FOLLOW: "bg-brand-soft text-brand-strong",
  MENTION: "bg-brand-soft text-brand-strong",
  MESSAGE: "bg-success/10 text-success-strong",
  CALL_MISSED: "bg-warning/10 text-warning-strong",
  INVITATION_RECEIVED: "bg-accent-soft text-accent",
  INVITATION_ACCEPTED: "bg-success/10 text-success-strong",
  COMPANY_ROLE_CHANGED: "bg-accent-soft text-accent",
  TEAM_ADDED: "bg-accent-soft text-accent",
  REPORT_STATUS: "bg-warning/10 text-warning-strong",
  SYSTEM: "bg-surface-2 text-ink-2",
};

/** Human-readable text — title/body are often null, so synthesize from type. */
function describe(n: NotificationItem): string {
  if (n.title) return n.title;
  const actor = n.actor ? n.actor.name : "Someone";
  switch (n.type) {
    case "LIKE":
      return n.entityType === "comment" ? `${actor} liked your comment` : `${actor} liked your post`;
    case "COMMENT":
      return `${actor} commented on your post`;
    case "FOLLOW":
      return `${actor} started following you`;
    case "MENTION":
      return `${actor} mentioned you`;
    case "MESSAGE":
      return `${actor} sent you a message`;
    case "CALL_MISSED":
      return `Missed call from ${actor}`;
    case "INVITATION_RECEIVED":
      return "You've been invited to join a company";
    case "INVITATION_ACCEPTED":
      return `${actor} accepted your invitation`;
    case "COMPANY_ROLE_CHANGED":
      return "Your company role was changed";
    case "TEAM_ADDED":
      return "You've been added to a team";
    case "REPORT_STATUS":
      return "There's an update on your report";
    case "SYSTEM":
      return "System update";
    default:
      return "New notification";
  }
}

/** Deep-link target, or null when the API doesn't expose enough to link. */
function targetHref(n: NotificationItem): string | null {
  const id = n.entityId;
  switch (n.entityType) {
    case "post":
      return id ? `/post/${id}` : null;
    case "user":
      return n.actor ? `/profile/${n.actor.username}` : null;
    case "conversation":
      return id ? `/messages/${id}` : null;
    case "company":
    case "team":
    case "invitation":
      return "/companies";
    case "call":
      return "/messages";
    // Legacy rows written before message notifications carried a conversation
    // id: there is no per-message route, so fall back to the inbox.
    case "message":
      return "/messages";
    default:
      // 'comment' and unknown entity types: no resolvable target (see note).
      if (n.type === "FOLLOW" && n.actor) return `/profile/${n.actor.username}`;
      // Report decisions are a security matter; land on the Security tab, not
      // on whichever tab the settings page happens to default to.
      if (n.type === "REPORT_STATUS") return "/settings?tab=security";
      if (n.type === "SYSTEM") return "/settings?tab=notifications";
      return null;
  }
}

export function NotificationCenter() {
  const router = useRouter();
  const [filter, setFilter] = useState<NotificationFilter>(DEFAULT_NOTIFICATION_FILTER);
  const [markingAll, setMarkingAll] = useState(false);
  const [serverUnread, setServerUnread] = useState<number | null>(null);

  // Live updates + the shared unread badge (same store the sidebar reads).
  const live = useNotifications();

  const list = useInfiniteList<NotificationItem>(
    useCallback(
      async (cursor: string | null) => {
        const page = await apiGet<NotificationPage>("/api/notifications", {
          params: { cursor, limit: PAGE_SIZE, ...notificationFilterParams(filter) },
        });
        // The authoritative badge count — total unread, independent of filter.
        setServerUnread(page.unreadCount ?? 0);
        return page;
      },
      [filter],
    ),
    (n) => n.id,
  );

  // Seed the shared badge with the server's count. `useInfiniteList` keeps the
  // latest `loadPage` in a ref, so `refresh()` below picks up the new filter.
  const skipFirstFilterRun = useRef(true);
  useEffect(() => {
    if (skipFirstFilterRun.current) {
      skipFirstFilterRun.current = false;
      return;
    }
    void list.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the filter changes
  }, [filter]);

  useEffect(() => {
    if (serverUnread === null) return;
    // Only the count matters here; the rows are owned by `list`.
    live.seed([], serverUnread);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed is stable
  }, [serverUnread]);

  // Prepend notifications that arrived over the socket. They bypassed the
  // server-side filter, so they must be checked against it here.
  useEffect(() => {
    if (live.notifications.length === 0) return;
    const fresh = live.notifications.filter((n) => notificationMatchesFilter(n, filter));
    if (fresh.length === 0) return;
    // Socket payloads lack PostAuthor.isVerified and the NotificationType
    // narrowing; normalize to the REST shape (display-only fields).
    list.prepend(
      fresh.map((n) => ({
        ...n,
        type: n.type as NotificationItem["type"],
        actor: n.actor ? { ...n.actor, isVerified: false } : null,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- list.prepend is stable
  }, [live.notifications, filter]);

  const sentinelRef = useIntersectionObserver(list.loadMore, {
    enabled: list.hasMore && !list.error && !list.loading,
  });

  const markOneRead = useCallback(
    async (n: NotificationItem) => {
      if (!n.readAt) {
        // Optimistic.
        list.setItems((prev) =>
          prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
        );
        live.markOneReadLocal(n.id);
        try {
          await apiPost(`/api/notifications/${n.id}/read`);
        } catch {
          // Roll back on failure.
          list.setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: null } : x)));
        }
      }
      const href = targetHref(n);
      if (href) router.push(href);
    },
    [list, live, router],
  );

  const markAllRead = async () => {
    setMarkingAll(true);
    const prev = list.items;
    list.setItems((items) =>
      items.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
    );
    // Shared store: this also clears the sidebar and mobile-nav badges.
    live.markAllReadLocal();
    try {
      await apiPost("/api/notifications/read", {});
      setServerUnread(0);
      toast({ variant: "success", title: "All notifications marked as read" });
    } catch (e) {
      list.setItems(prev);
      void list.refresh();
      toast({
        variant: "error",
        title: e instanceof ApiError ? e.message : "Couldn't mark notifications as read",
      });
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = live.unreadCount;
  const isEmpty = list.items.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <DesktopNotificationPrompt />

      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-h1 font-bold tracking-tight">Notifications</h1>
          {unreadCount > 0 && (
            <span
              aria-label={`${unreadCount} unread`}
              className="rounded-full bg-brand px-2.5 py-0.5 text-caption font-bold text-on-brand"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          loading={markingAll}
          disabled={unreadCount === 0}
          onClick={() => void markAllRead()}
        >
          <Icon name="check" size={16} />
          Mark all read
        </Button>
      </div>

      {/* Filters — the same scrollable rail the admin and company consoles
          use, chevrons included. The SegmentedControl keeps its own sliding
          indicator and is told not to scroll itself (`max-w-none
          overflow-visible`), so this rail is the single scroller and the edge
          fades line up with the real overflow. */}
      <ScrollNav ariaLabel="Filter notifications" className="mt-0">
        <SegmentedControl
          value={filter}
          onValueChange={(v) => setFilter(v as NotificationFilter)}
          options={FILTER_OPTIONS}
          label="Filter notifications"
          className="max-w-none overflow-visible"
        />
      </ScrollNav>

      {/* List */}
      {list.loading ? (
        <div className="flex flex-col gap-2" aria-label="Loading notifications">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-3 rounded-xl border border-line bg-surface p-4">
              <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-2/3 rounded" />
                <Skeleton className="mt-2 h-3 w-1/3 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : list.error && isEmpty ? (
        <ErrorState
          title="Couldn't load notifications"
          message={list.error.message}
          retryLabel="Try again"
          onRetry={list.retry}
        />
      ) : isEmpty ? (
        <EmptyState
          icon="bell"
          title={filter === "unread" ? "You're all caught up" : "No notifications"}
          description={
            filter === "unread"
              ? "Nothing unread right now."
              : filter === "all"
                ? "Likes, comments, follows, and messages will show up here."
                : "Nothing in this category yet. Try another filter."
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.items.map((n) => (
            <NotificationRow key={n.id} notification={n} onOpen={() => void markOneRead(n)} />
          ))}
        </ul>
      )}

      {list.loadingMore && (
        <div className="flex justify-center py-4" aria-label="Loading more notifications">
          <Spinner />
        </div>
      )}

      {/* A failed *later* page used to be invisible: the error state above only
          renders when nothing loaded, and `loadMore` refuses to run while an
          error is set — so the list silently stopped growing. */}
      {list.error && !isEmpty && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3"
        >
          <p className="text-body-sm text-ink">
            Couldn&apos;t load more notifications. {list.error.message}
          </p>
          <Button variant="outline" size="sm" onClick={list.retry}>
            Try again
          </Button>
        </div>
      )}

      {list.hasMore && !list.loading && !list.error && <div ref={sentinelRef} aria-hidden className="h-2" />}
      {!list.hasMore && !isEmpty && (
        <p className="py-4 text-center text-caption text-ink-3">No more notifications.</p>
      )}
    </div>
  );
}

function NotificationRow({
  notification: n,
  onOpen,
}: {
  notification: NotificationItem;
  onOpen: () => void;
}) {
  const href = targetHref(n);
  const unread = !n.readAt;

  const content = (
    <>
      <span className="relative shrink-0">
        {n.actor ? (
          <Avatar src={n.actor.avatarUrl} name={n.actor.name} size="md" />
        ) : (
          <span
            aria-hidden
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full",
              TYPE_TONE[n.type] ?? TYPE_TONE.SYSTEM,
            )}
          >
            <Icon name={TYPE_ICON[n.type] ?? "info"} size={20} />
          </span>
        )}
        {n.actor && (
          <span
            aria-hidden
            className={cn(
              "absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-surface",
              TYPE_TONE[n.type] ?? TYPE_TONE.SYSTEM,
            )}
          >
            <Icon name={TYPE_ICON[n.type] ?? "info"} size={11} />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-body-sm", unread ? "font-semibold text-ink" : "text-ink-2")}>
          {describe(n)}
        </span>
        {n.body && <span className="mt-0.5 block truncate text-caption text-ink-3">{n.body}</span>}
        <span className="mt-0.5 block text-caption text-ink-3">{timeAgo(n.createdAt)}</span>
      </span>
      {unread && (
        <span aria-label="Unread" className="h-2.5 w-2.5 shrink-0 self-center rounded-full bg-brand" />
      )}
      {href && <Icon name="chevronRight" size={16} className="shrink-0 self-center text-ink-3" aria-hidden />}
    </>
  );

  const className = cn(
    "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors duration-fast",
    unread
      ? "border-brand/30 bg-brand-soft/40 hover:bg-brand-soft/70"
      : "border-line bg-surface hover:bg-surface-2",
  );

  return (
    <li>
      {/* Every row is a button so it can always be marked read. Rows with no
          resolvable target still mark read — `onOpen` only navigates when a
          href exists. Previously those rows were inert <div>s and could never
          be cleared individually. */}
      <button
        type="button"
        onClick={onOpen}
        className={className}
        aria-label={`${describe(n)}${unread ? " (unread)" : ""}`}
      >
        {content}
      </button>
    </li>
  );
}

/** Small toggle row used by the settings page (notification preferences). */
export function NotificationPrefRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-body-sm font-medium text-ink">{label}</p>
        {description && <p className="text-caption text-ink-3">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} label={label} />
    </div>
  );
}
