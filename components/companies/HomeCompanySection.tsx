/**
 * components/companies/HomeCompanySection.tsx — the Home "Your company" feed.
 *
 * Three rules drive the whole component:
 *
 *   1. NO COMPANY, NO FEED — but not no section. A viewer who belongs to no
 *      company sees `NoCompanyYet`, which tells them who to ask. This used to
 *      render nothing at all, on the theory that a section nobody belongs to
 *      should not exist; the product rule changed, because a user cannot create
 *      a company and cannot add themselves to one, so silence left them with no
 *      way to find out how. The empty state is now the whole point.
 *   2. OWN COMPANY ONLY. Posts come from `/api/companies/[id]/posts`, which is
 *      membership-gated on the server, and each company is rendered in its own
 *      block. One company's posts can never appear under another company's
 *      name, and a viewer is never shown a company they are not in.
 *   3. NO APPLICATION STATUS. Manager-application state is never fetched or
 *      rendered here, so a pending / approved / declined application cannot
 *      leak into Home.
 *
 * The membership fetch resolves in a microtask rather than setting state
 * synchronously in the effect body, so mounting this section costs one render,
 * not a cascading chain. While it is in flight nothing is rendered: showing a
 * skeleton would flash the "ask your manager" card at people who are already in
 * a company, which reads as a bug.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Avatar, Badge, Button, Icon, Skeleton } from "@/components/ui";
import { NoCompanyYet } from "@/components/companies/NoCompanyYet";
import { apiGet } from "@/lib/api-client";
import { companyRoleBadgeVariant, companyRoleLabel } from "@/lib/company-roles";
import { timeAgo } from "@/lib/format";
import type { Page, Post } from "@/lib/api-types";
import type { CompanyMembership } from "@/lib/types";

/** How many posts of a company to show before "View all". */
const POSTS_PER_COMPANY = 4;

export function HomeCompanySection() {
  const [rows, setRows] = useState<CompanyMembership[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiGet<CompanyMembership[]>("/api/companies")
      .then((res) => {
        if (!cancelled) setRows(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load your company");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Nothing is rendered until membership is known. A skeleton (or a heading)
  // shown while loading would flash a section at viewers who are in no company
  // — and this section must not exist for them at all.
  if (rows === null && error === null) return null;

  // A failed membership read must not invent a company, so we show a quiet
  // retry instead of guessing — and deliberately no "Your companies" heading,
  // because we do not yet know that the viewer has any.
  if (error !== null) {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3"
      >
        <p className="text-body-sm text-ink-2">{error}</p>
        <Button size="sm" variant="ghost" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  // Rule 1 — no company, and the card that explains how to get one. The heading
  // is dropped here on purpose: there is nothing to enumerate yet, and "Your
  // companies (0)" would be a worse sentence than the card's own title.
  if (!rows || rows.length === 0) return <NoCompanyYet />;

  return (
    <section aria-labelledby="home-company" className="flex flex-col gap-3">
      <h2 id="home-company" className="flex items-center gap-2 text-h3 font-semibold text-ink">
        <Icon name="building" size={18} aria-hidden className="text-ink-3" />
        {rows.length === 1 ? "Your company" : "Your companies"}
        <span className="text-body-sm font-normal text-ink-3">({rows.length})</span>
      </h2>
      {rows.map((membership) => (
        <CompanyPosts key={membership.company.id} membership={membership} />
      ))}
    </section>
  );
}

/**
 * One company: its header, and its own posts. Owns its own fetch so a slow
 * company cannot hold up the others, and so the membership-gated route stays
 * the only path posts can arrive through.
 */
function CompanyPosts({ membership }: { membership: CompanyMembership }) {
  const { company, role } = membership;
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const retry = useCallback(() => {
    setFailed(false);
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiGet<Page<Post>>(`/api/companies/${company.id}/posts`, {
      params: { limit: POSTS_PER_COMPANY },
    })
      .then((res) => {
        if (!cancelled) setPosts(res.data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [company.id, reloadKey]);

  const loading = posts === null && !failed;

  return (
    <section
      aria-label={`${company.name} posts`}
      className="rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex items-center gap-3">
        <Avatar src={company.logoUrl} name={company.name} size="md" />
        <div className="min-w-0 flex-1">
          <Link
            href={`/company/${company.slug}`}
            className="block truncate text-body-sm font-medium text-ink hover:underline"
          >
            {company.name}
          </Link>
          <Badge variant={companyRoleBadgeVariant(role)} className="mt-0.5">
            {companyRoleLabel(role)}
          </Badge>
        </div>
        <Link
          href={`/company/${company.slug}`}
          className="shrink-0 text-caption font-medium text-brand-strong hover:underline"
        >
          View all
        </Link>
      </div>

      {failed ? (
        <div role="alert" className="mt-3 flex items-center justify-between gap-3">
          <p className="text-body-sm text-ink-2">Couldn&apos;t load these posts.</p>
          <Button size="sm" variant="ghost" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : loading ? (
        <div className="mt-3 flex flex-col gap-2" aria-busy>
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : !posts || posts.length === 0 ? (
        <p className="mt-3 text-body-sm text-ink-3">
          No posts in {company.name} yet. Be the first to share an update.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-0.5">
          {posts.map((post) => (
            <li key={post.id}>
              <Link
                href={`/post/${post.id}`}
                className="flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2"
              >
                <Avatar src={post.author.avatarUrl} name={post.author.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="truncate text-body-sm font-medium text-ink">
                      {post.author.name}
                    </span>
                    <span className="shrink-0 text-caption text-ink-3">
                      {timeAgo(post.createdAt)}
                    </span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-body-sm text-ink-2">
                    {post.body || "Shared an attachment"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
