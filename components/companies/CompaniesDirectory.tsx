/**
 * components/companies/CompaniesDirectory.tsx — /companies.
 * Search + cards of the viewer's companies; create button (managers only).
 *
 * `canCreateCompany` is decided by the Server Component that renders this
 * (app/(app)/companies/page.tsx) from the real policy, not guessed here. When
 * it is false there is no create button and no "Create a company" prompt —
 * showing one would offer an action the server refuses. A plain user's route
 * into a company is their manager, so that is what the empty state says
 * (`NoCompanyYet`).
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Icon,
  Input,
  LoadingState,
  ErrorState,
} from "@/components/ui";
import { NoCompanyYet } from "@/components/companies/NoCompanyYet";
import { CompanyPostsFeed } from "@/components/companies/CompanyPostsFeed";
import { apiGet } from "@/lib/api-client";
import { companyRoleBadgeVariant, companyRoleLabel } from "@/lib/company-roles";
import { formatRelative } from "@/lib/chat";
import type { CompanyMembership } from "@/lib/types";

export interface CompaniesDirectoryProps {
  /** Whether the viewer may create a company — decided server-side. */
  canCreateCompany: boolean;
  /** The viewer's tier and cap, for the "2 of 3 companies" caption. */
  membership?: { tier: string; limit: number | null; current: number } | null;
}

/** Which empty state to show when nothing is listed. */
export type CompaniesEmptyKind = "no-match" | "can-create" | "no-company-yet";

/**
 * Pick the empty state.
 *
 * Pulled out of the component so the choice can be asserted directly. The
 * distinction that matters is the last one: a viewer who cannot create a
 * company and is in none must be told who to ask, not offered a button that
 * the server would refuse. Reaching that branch through the component would
 * mean waiting on a fetch, which is why it is a function of two booleans here.
 */
export function companiesEmptyKind(opts: {
  query: string;
  canCreateCompany: boolean;
}): CompaniesEmptyKind {
  if (opts.query.trim()) return "no-match";
  return opts.canCreateCompany ? "can-create" : "no-company-yet";
}

export function CompaniesDirectory({
  canCreateCompany,
  membership = null,
}: CompaniesDirectoryProps) {
  const router = useRouter();
  const [rows, setRows] = useState<CompanyMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await apiGet<CompanyMembership[]>("/api/companies"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load companies.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.company.name.toLowerCase().includes(q) ||
        r.company.slug.toLowerCase().includes(q) ||
        (r.company.description ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const emptyKind = companiesEmptyKind({ query, canCreateCompany });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-h1 font-bold text-ink">Companies</h1>
          <p className="mt-1 text-body-sm text-ink-2">Workspaces you belong to.</p>
          {/* The cap, stated plainly, so a refusal is never a surprise. Only
              capped tiers see it — "unlimited" is not worth a line of text. */}
          {membership && membership.limit !== null && (
            <p className="mt-0.5 text-caption text-ink-3">
              {membership.current} of {membership.limit}{" "}
              {membership.limit === 1 ? "company" : "companies"}
            </p>
          )}
        </div>
        {canCreateCompany && (
          <Button href="/companies/new">
            <Icon name="plus" size={16} aria-hidden className="mr-1.5" />
            New company
          </Button>
        )}
      </div>

      <div className="relative mt-5 max-w-md">
        <Icon name="search" size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search companies"
          aria-label="Search companies"
          className="pl-9"
        />
      </div>

      <div className="mt-5">
        {loading ? (
          <LoadingState message="Loading companies…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : filtered.length === 0 ? (
          emptyKind === "no-match" ? (
            <EmptyState
              icon="building"
              title="No companies match"
              description="Try a different search."
            />
          ) : emptyKind === "can-create" ? (
            // A manager with no company yet: creating one is exactly the next
            // step, so offer it.
            <EmptyState
              icon="building"
              title="No companies yet"
              description="Create a company to start collaborating, or ask a manager to invite you."
              actionLabel="Create a company"
              onAction={() => router.push("/companies/new")}
            />
          ) : (
            // A plain user with no company. They cannot create one and cannot
            // add themselves to one — their manager does that. Say so, in
            // Bengali, instead of showing a button that would be refused.
            <NoCompanyYet />
          )
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
            {filtered.map(({ company, role, joinedAt }) => (
              <Link key={company.id} href={`/company/${company.slug}`} role="listitem" aria-label={company.name}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardContent className="flex flex-col gap-3 p-5">
                    <div className="flex items-center gap-3">
                      <Avatar src={company.logoUrl} name={company.name} size="lg" fallbackIcon="building" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-sm font-semibold text-ink" title={company.name}>{company.name}</p>
                        <p className="truncate text-caption text-ink-3">/{company.slug}</p>
                      </div>
                      <Badge variant={companyRoleBadgeVariant(role)}>
                        {companyRoleLabel(role)}
                      </Badge>
                    </div>
                    {company.description && (
                      <p className="line-clamp-2 text-body-sm text-ink-2">{company.description}</p>
                    )}
                    <p className="mt-auto text-caption text-ink-3">Joined {formatRelative(joinedAt)}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* The company system lives in this section and nowhere else — Home shows
          no company content at all. These are full `PostCard`s, so like,
          comment, repost, bookmark and share all work; each read is
          membership-gated on the server. Rendered only once the membership
          list is known and non-empty, so the "ask your manager" state above
          stays the only empty state on the page. */}
      {!loading && !error && filtered.length > 0 && (
        <CompanyPostsFeed memberships={filtered} />
      )}
    </div>
  );
}
