/**
 * components/layout/ActiveCompanyMembers.tsx — the Home right-rail card under
 * "Trending now": the members of the viewer's companies, with who is around.
 *
 * Mozammel bhai's ask: "Home section er right side e trending now er niche notun
 * ekta bar ano, jeikhane jei companies add ache oi company er members ra ke
 * active ache sei gulo dekha jabe like facebook er moton, then name er upore
 * click korle message kora jabe sundor kore."
 *
 * ── Where the data comes from ─────────────────────────────────────────────
 *
 * There is no "members of my companies" endpoint, and adding one would mean a
 * new service, a new route and a new schema for a purely presentational list.
 * The three reads that already exist compose into it:
 *
 *   GET /api/companies                  → which companies the viewer is in
 *   GET /api/companies/:id/members      → who is in each of them
 *   GET /api/presence?ids=…             → and who is online (see usePresence)
 *
 * Three companies at most, because the cap for a manager is three and an
 * administrator with dozens of companies does not want all of them here. The
 * presence map is live: `usePresence` re-reads it on the polling transport and
 * takes `presence:update` pushes on the socket one.
 *
 * ── "Active" ──────────────────────────────────────────────────────────────
 *
 * Everyone found is listed — the card is a shortcut to a colleague, and hiding
 * the offline ones would make it useless at the exact moment somebody wants to
 * leave a message. What the sort does is put the reachable people first, and
 * the header states the count, so "who is active" is answered at a glance
 * without the list pretending the others do not exist.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Button,
  Card,
  Dialog,
  DialogFooter,
  Icon,
  Skeleton,
  Textarea,
  toast,
  toPresenceStatus,
  type PresenceStatus,
} from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { usePresence } from "@/lib/realtime/client";
import { useSession } from "@/lib/auth-client";
import type { PublicUser } from "@/lib/types";

/** Companies to pull members from, newest first. */
const MAX_COMPANIES = 3;
/** Members requested per company. */
const MEMBERS_PER_COMPANY = 20;
/** Rows actually rendered. */
const MAX_ROWS = 10;

interface Membership {
  company: { id: string; name: string; slug: string };
  role: string;
}

interface MemberPage {
  data: { user: PublicUser; role: string }[];
}

interface Row {
  user: PublicUser;
  companyName: string;
}

/** Reachability order — the whole point of the sort. */
const STATUS_RANK: Record<PresenceStatus, number> = {
  online: 0,
  away: 1,
  dnd: 2,
  offline: 3,
};

export function ActiveCompanyMembers() {
  const { user } = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  /**
   * How many companies the viewer belongs to. Tracked separately from `rows`
   * because the two empty cases are NOT the same: "in no company" must hide
   * the card entirely, while "in a company whose only member is you" is worth
   * saying out loud — otherwise a brand-new company looks like a broken
   * feature rather than a quiet one.
   */
  const [companyCount, setCompanyCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const [composing, setComposing] = useState<Row | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setFailed(false);

    (async () => {
      try {
        const memberships = await apiGet<Membership[]>("/api/companies");
        const companies = memberships.slice(0, MAX_COMPANIES);
        if (!cancelled) setCompanyCount(memberships.length);
        if (companies.length === 0) {
          if (!cancelled) setRows([]);
          return;
        }

        const pages = await Promise.all(
          companies.map((m) =>
            apiGet<MemberPage>(
              `/api/companies/${encodeURIComponent(m.company.id)}/members`,
              { params: { limit: MEMBERS_PER_COMPANY } },
            )
              .then((page) => ({ company: m.company, page }))
              // One inaccessible company must not empty the whole card.
              .catch(() => null),
          ),
        );

        const seen = new Set<string>();
        const out: Row[] = [];
        for (const entry of pages) {
          if (!entry) continue;
          for (const member of entry.page.data ?? []) {
            const id = member.user?.id;
            if (!id || id === user.id || seen.has(id)) continue;
            seen.add(id);
            out.push({ user: member.user, companyName: entry.company.name });
          }
        }
        if (!cancelled) setRows(out);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- reload only when the viewer changes

  const ids = useMemo(() => (rows ?? []).map((r) => r.user.id), [rows]);
  const presence = usePresence(ids);

  const ordered = useMemo(() => {
    if (!rows) return null;
    const rank = (r: Row) => STATUS_RANK[toPresenceStatus(presence[r.user.id]?.status)];
    return [...rows]
      .sort((a, b) => rank(a) - rank(b) || a.user.name.localeCompare(b.user.name))
      .slice(0, MAX_ROWS);
  }, [rows, presence]);

  const activeCount = useMemo(
    () =>
      (rows ?? []).filter((r) => {
        const status = toPresenceStatus(presence[r.user.id]?.status);
        return status === "online" || status === "away";
      }).length,
    [rows, presence],
  );

  if (failed) return null;

  /*
   * Nothing at all when the viewer is in no company.
   *
   * "You are not in a company yet" is a Companies-tab message — Mozammel bhai
   * was explicit that Home must never carry it. A card in the rail saying the
   * same thing would be that message wearing a hat, so the whole card is
   * absent until there is a company to talk about.
   */
  if (rows !== null && companyCount === 0) return null;

  return (
    <>
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-h3 font-bold text-ink">Active members</h2>
          {rows !== null && rows.length > 0 && (
            <span className="flex items-center gap-1.5 text-caption font-medium text-success-strong">
              <span aria-hidden className="h-2 w-2 rounded-full bg-success" />
              {activeCount} active
            </span>
          )}
        </div>
        <p className="mt-0.5 text-caption text-ink-3">People from your companies</p>

        <div className="mt-3 flex flex-col">
          {ordered === null ? (
            <div className="flex flex-col gap-3" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                  <div className="flex-1">
                    <Skeleton className="h-3.5 w-2/3 rounded" />
                    <Skeleton className="mt-1.5 h-3 w-1/3 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : ordered.length === 0 ? (
            <p className="py-4 text-center text-body-sm text-ink-3">
              You&apos;re the only member of your company so far. Teammates appear here
              as they join.
            </p>
          ) : (
            ordered.map((row) => (
              <MemberRow
                key={row.user.id}
                row={row}
                status={toPresenceStatus(presence[row.user.id]?.status)}
                onMessage={() => setComposing(row)}
              />
            ))
          )}
        </div>
      </Card>

      <MessageMemberDialog
        row={composing}
        onOpenChange={(open) => !open && setComposing(null)}
      />
    </>
  );
}

function MemberRow({
  row,
  status,
  onMessage,
}: {
  row: Row;
  status: PresenceStatus;
  onMessage: () => void;
}) {
  const offline = status === "offline";
  return (
    <button
      type="button"
      onClick={onMessage}
      aria-label={`Message ${row.user.name}${offline ? " (offline)" : ""}`}
      className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand"
    >
      <Avatar src={row.user.avatarUrl} name={row.user.name} size="md" status={status} />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-body-sm font-semibold group-hover:text-brand-strong",
            offline ? "text-ink-2" : "text-ink",
          )}
        >
          {row.user.name}
        </span>
        <span className="block truncate text-caption text-ink-3">{row.companyName}</span>
      </span>
      <Icon
        name="message"
        size={16}
        aria-hidden
        className="shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}

/**
 * A small "write the first message" dialog.
 *
 * The profile page's "Message" button creates the conversation and navigates,
 * which is fine there because the profile is a destination. Here the click
 * means "say something to this person", so the box is the point: type, send,
 * land in the thread. Both requests are the ones the app already makes — the
 * conversation is created with `POST /api/conversations`, and the first message
 * with `POST /api/conversations/:id/messages`, the same endpoint the polling
 * transport posts to.
 */
function MessageMemberDialog({
  row,
  onOpenChange,
}: {
  row: Row | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (row) setBody("");
  }, [row?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps -- reset for the newly chosen person

  const open = row !== null;

  const send = useCallback(async () => {
    if (!row) return;
    const text = body.trim();
    setSending(true);
    try {
      const convo = await apiPost<{ conversation: { id: string } }>("/api/conversations", {
        type: "DM",
        userIds: [row.user.id],
      });
      const conversationId = convo.conversation.id;
      if (text) {
        await apiPost(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
          body: text,
        });
      }
      onOpenChange(false);
      router.push(`/messages/${conversationId}`);
    } catch (e) {
      toast({
        variant: "error",
        title:
          e instanceof ApiError && e.status === 403
            ? "You can't message this person."
            : e instanceof Error
              ? e.message
              : "Couldn't send the message",
      });
    } finally {
      setSending(false);
    }
  }, [row, body, router, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={row ? `Message ${row.user.name}` : "Message"}
      description={row ? `${row.companyName} · @${row.user.username}` : undefined}
      size="md"
    >
      {row && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Avatar src={row.user.avatarUrl} name={row.user.name} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-body font-semibold text-ink">{row.user.name}</p>
              <p className="truncate text-caption text-ink-3">@{row.user.username}</p>
            </div>
          </div>

          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder={`Write something to ${row.user.name}…`}
            aria-label="Message"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
            }}
          />

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button loading={sending} onClick={() => void send()}>
              <Icon name="send" size={16} aria-hidden className="mr-1.5" />
              {body.trim() ? "Send" : "Open chat"}
            </Button>
          </DialogFooter>
        </div>
      )}
    </Dialog>
  );
}
