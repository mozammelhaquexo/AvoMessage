/**
 * components/companies/MyCompaniesCard.tsx — the viewer's own company list.
 *
 * The full card on your own profile, where the "Leave company" action lives.
 * The compact Home variant that used to share this file now lives in
 * `HomeCompanySection.tsx`, because it shows company POSTS rather than a
 * link-out list and is members-only.
 *
 * Leaving is server-authoritative: `removeMember` performs the whole
 * detach (teams + company group conversations + the membership row) in one
 * transaction, and refuses to let the last owner leave. This component only
 * decides what to show.
 *
 * Role labels go through `@/lib/company-roles`, so this card can never print
 * "Owner" — see that module for why.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  Icon,
  Skeleton,
  toast,
} from "@/components/ui";
import { NoCompanyYet } from "@/components/companies/NoCompanyYet";
import { apiDelete, apiGet, ApiError } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import { companyRoleBadgeVariant, companyRoleLabel } from "@/lib/company-roles";
import { formatRelative } from "@/lib/chat";
import type { CompanyMembership } from "@/lib/types";

export function MyCompaniesCard() {
  const { user } = useSession();
  const [rows, setRows] = useState<CompanyMembership[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [leaving, setLeaving] = useState<CompanyMembership | null>(null);
  const [busy, setBusy] = useState(false);

  const retry = useCallback(() => {
    setError(null);
    setReloadKey((k) => k + 1);
  }, []);

  // Resolved in a microtask rather than setting state synchronously in the
  // effect body — one render on mount instead of a cascading chain.
  useEffect(() => {
    let cancelled = false;
    apiGet<CompanyMembership[]>("/api/companies")
      .then((res) => {
        if (!cancelled) setRows(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load your companies");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const loading = rows === null && error === null;

  async function leave(target: CompanyMembership) {
    if (!user) return;
    setBusy(true);
    try {
      await apiDelete(
        `/api/companies/${target.company.id}/members/${user.id}`,
      );
      setRows((prev) => (prev ?? []).filter((r) => r.company.id !== target.company.id));
      setLeaving(null);
      toast({
        variant: "success",
        title: `You left ${target.company.name}`,
      });
    } catch (e) {
      const message =
        e instanceof ApiError && e.code === "LAST_OWNER"
          ? "You are the last manager. Ask an administrator before leaving."
          : e instanceof Error
            ? e.message
            : "Could not leave this company";
      toast({ variant: "error", title: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="profile-companies"
      className="rounded-lg border border-line bg-surface p-4"
    >
      <SectionHeading count={rows?.length} />

      {loading ? (
        <div className="mt-3 flex flex-col gap-2" aria-busy>
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5">
          <p className="text-body-sm font-medium text-danger-strong">{error}</p>
          <Button size="sm" variant="ghost" className="mt-1" onClick={retry}>
            Try again
          </Button>
        </div>
      ) : !rows || rows.length === 0 ? (
        // Same card as Home, deliberately: this state has one explanation, and
        // a second, differently-worded one here would just be a second thing to
        // keep in sync. The "Discover" link in the heading still leads to the
        // directory for anyone who wants to request a join.
        <div className="mt-3">
          <NoCompanyYet compact />
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.company.id}
              className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5"
            >
              <Avatar src={r.company.logoUrl} name={r.company.name} size="md" />
              <span className="min-w-0 flex-1">
                <Link
                  href={`/company/${r.company.slug}`}
                  className="block truncate text-body-sm font-medium text-ink hover:underline"
                >
                  {r.company.name}
                </Link>
                <span className="flex items-center gap-1.5 text-caption text-ink-3">
                  <Badge variant={companyRoleBadgeVariant(r.role)}>
                    {companyRoleLabel(r.role)}
                  </Badge>
                  <span>Joined {formatRelative(r.joinedAt)}</span>
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => setLeaving(r)}
              >
                Leave
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={leaving !== null}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
        title={leaving ? `Leave ${leaving.company.name}?` : "Leave company?"}
        description="You'll be removed from the company's teams, its group chats, and its private feed. Your own posts and direct messages stay where they are."
        confirmLabel="Leave company"
        tone="danger"
        icon="logout"
        confirming={busy}
        onConfirm={() => {
          if (leaving) void leave(leaving);
        }}
      />
    </section>
  );
}

function SectionHeading({ count }: { count?: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 id="profile-companies" className="flex items-center gap-2 text-h3 font-semibold text-ink">
        <Icon name="building" size={18} aria-hidden className="text-ink-3" />
        Your companies
        {count !== undefined && count > 0 && (
          <span className="text-body-sm font-normal text-ink-3">({count})</span>
        )}
      </h2>
      <Link href="/companies" className="text-caption font-medium text-brand-strong hover:underline">
        Discover
      </Link>
    </div>
  );
}
