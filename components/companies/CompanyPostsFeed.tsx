/**
 * components/companies/CompanyPostsFeed.tsx — the interactive company feed on
 * /companies.
 *
 * Company posts used to surface on Home as bare links (`HomeCompanySection`).
 * The product rule is now: the company system lives in the Companies section
 * and nowhere else. So this renders the viewer's company posts as full
 * `PostCard`s — like, comment, repost, bookmark and share all work — and Home
 * shows none of it.
 *
 * Three things this component deliberately does NOT do:
 *
 *   1. It does not decide membership. The caller passes the memberships it
 *      already fetched, so there is one source of truth for "which companies am
 *      I in" and no second round-trip.
 *   2. It does not render the empty state. A viewer with no company gets
 *      `NoCompanyYet` from `CompaniesDirectory`, and only there; rendering it
 *      from both places would put the card on the page twice.
 *   3. It does not fetch a company-private endpoint for a company the viewer is
 *      not in. Every read goes through `/api/companies/[id]/posts`, which is
 *      membership-gated on the server, so the client cannot widen its own view.
 *
 * One company's feed failing does not blank the section: that company
 * contributes zero posts and the rest still render.
 *
 * ── Why the result is keyed ───────────────────────────────────────────────
 *
 * The result carries the key it was fetched for, and "loading" is DERIVED
 * (`state.key !== feedKey`) rather than written by the effect. Resetting with
 * `setState(null)` inside the effect body would be a cascading render on every
 * membership change — and the repo's lint baseline treats that as a real
 * warning, not noise. Deriving it also makes the stale-feed window impossible:
 * a result that arrives after the memberships changed simply does not match the
 * key and is ignored.
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar, Button, Icon, Skeleton } from "@/components/ui";
import { PostCard } from "@/components/posts/PostCard";
import { apiGet } from "@/lib/api-client";
import type { Page, Post } from "@/lib/api-types";
import { mergeCompanyFeed, type CompanyFeedItem } from "@/lib/company-feed";
import type { CompanyMembership } from "@/lib/types";

/** How many of each company's posts to show before the workspace's own Feed. */
const POSTS_PER_COMPANY = 5;

/** A finished fetch, tagged with the key it answers. */
type FeedResult =
  | { key: string; status: "ready"; items: CompanyFeedItem[] }
  | { key: string; status: "error" };

export interface CompanyPostsFeedProps {
  /** The viewer's memberships — already fetched by the parent. */
  memberships: CompanyMembership[];
}

export function CompanyPostsFeed({ memberships }: CompanyPostsFeedProps) {
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<FeedResult | null>(null);

  // A stable identity for the membership set. The effect must re-run when the
  // viewer joins or leaves a company, not on every parent render — the parent
  // builds a fresh array each time.
  const companyIds = memberships.map((m) => m.company.id).join(",");
  const feedKey = `${companyIds}|${reloadKey}`;

  useEffect(() => {
    let cancelled = false;
    const byId = new Map(memberships.map((m) => [m.company.id, m.company]));
    const ids = companyIds === "" ? [] : companyIds.split(",");

    Promise.all(
      ids.map(async (id) => {
        try {
          const res = await apiGet<Page<Post>>(`/api/companies/${id}/posts`, {
            params: { limit: POSTS_PER_COMPANY },
          });
          const company = byId.get(id);
          if (!company) return [] as CompanyFeedItem[];
          return res.data.map((post) => ({ post, company }));
        } catch {
          // Swallowed on purpose — see the header. A 403 here would mean the
          // membership list and the server disagree, and the right response is
          // to show the other companies rather than an error page.
          return [] as CompanyFeedItem[];
        }
      }),
    )
      .then((lists) => {
        if (!cancelled) setResult({ key: feedKey, status: "ready", items: mergeCompanyFeed(lists) });
      })
      .catch(() => {
        if (!cancelled) setResult({ key: feedKey, status: "error" });
      });

    return () => {
      cancelled = true;
    };
    // `memberships` is intentionally not a dependency: it is a fresh array on
    // every render, and `feedKey` already encodes everything that changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedKey]);

  // No company, no section — and the caller owns the empty state (rule 2).
  if (memberships.length === 0) return null;

  // Anything that is not an answer to the CURRENT key is still loading.
  const current = result !== null && result.key === feedKey ? result : null;

  return (
    <section aria-labelledby="company-posts" className="mt-8 flex flex-col gap-3">
      <h2
        id="company-posts"
        className="flex items-center gap-2 text-h3 font-semibold text-ink"
      >
        <Icon name="building" size={18} aria-hidden className="text-ink-3" />
        Posts from your companies
      </h2>

      {current === null ? (
        <div className="flex flex-col gap-3" aria-busy>
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : current.status === "error" ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3"
        >
          <p className="text-body-sm text-ink-2">Couldn&apos;t load company posts.</p>
          <Button size="sm" variant="ghost" onClick={() => setReloadKey((k) => k + 1)}>
            Try again
          </Button>
        </div>
      ) : current.items.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-3 text-body-sm text-ink-3">
          No posts in your companies yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {current.items.map(({ post, company }) => (
            <li key={post.id} className="flex flex-col gap-1.5">
              <Link
                href={`/company/${company.slug}`}
                className="flex w-fit items-center gap-2 text-caption text-ink-3 hover:underline"
              >
                <Avatar
                  src={company.logoUrl}
                  name={company.name}
                  size="xs"
                  fallbackIcon="building"
                />
                {company.name}
              </Link>
              <PostCard post={post} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
