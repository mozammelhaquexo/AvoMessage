/**
 * app/(app)/search/page.tsx — unified search.
 * `?q=` query, `?type=` tab (users/posts/hashtags/companies).
 * Next.js 16: searchParams is a Promise — unwrap with React.use().
 */
"use client";

import { Suspense, use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Avatar,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  SegmentedControl,
  Skeleton,
  Spinner,
} from "@/components/ui";
import { apiGet } from "@/lib/api-client";
import { useInfiniteList, useIntersectionObserver } from "@/lib/hooks";
import type { CompanySummary, HashtagResult, Page, Post, SearchUser } from "@/lib/api-types";
import { SearchBar } from "@/components/search/SearchBar";
import { PostCard } from "@/components/posts/PostCard";

type SearchType = "users" | "posts" | "hashtags" | "companies";

const TYPES: { value: SearchType; label: string }[] = [
  { value: "users", label: "People" },
  { value: "posts", label: "Posts" },
  { value: "hashtags", label: "Hashtags" },
  { value: "companies", label: "Companies" },
];

function SearchContent({
  initialQ,
  initialType,
}: {
  initialQ: string;
  initialType: SearchType;
}) {
  const router = useRouter();
  const [type, setType] = useState<SearchType>(initialType);
  const [query, setQuery] = useState(initialQ);

  // Keep the URL in sync with the active tab.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("type") !== type && query) {
      router.replace(`/search?q=${encodeURIComponent(query)}&type=${type}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  if (!query) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <SearchBar autoFocus />
        <div className="mt-6">
          <TrendingTags />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <SearchBar
        key={query}
        initialQuery={query}
        onSubmitQuery={(q) => {
          setQuery(q);
          router.replace(`/search?q=${encodeURIComponent(q)}&type=${type}`, { scroll: false });
        }}
      />
      <SegmentedControl
        label="Search type"
        value={type}
        onValueChange={(v) => setType(v as SearchType)}
        options={TYPES}
      />
      <SearchResults key={`${query}:${type}`} query={query} type={type} />
    </div>
  );
}

function SearchResults({ query, type }: { query: string; type: SearchType }) {
  const list = useInfiniteList<SearchUser | Post | HashtagResult | CompanySummary>(
    useCallback(
      (cursor: string | null) =>
        apiGet<Page<SearchUser | Post | HashtagResult | CompanySummary>>("/api/search", {
          params: { q: query, type, cursor, limit: 20 },
        }),
      [query, type],
    ),
    (item) => (item as { id?: string }).id ?? (item as HashtagResult).tag,
  );
  const sentinelRef = useIntersectionObserver(list.loadMore, {
    enabled: list.hasMore && !list.error && !list.loading,
  });

  if (list.loading) {
    return (
      <div className="flex flex-col gap-2" aria-label="Searching">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (list.error && list.items.length === 0) {
    return (
      <ErrorState
        title="Search failed"
        message={list.error.message}
        retryLabel="Try again"
        onRetry={list.retry}
      />
    );
  }
  if (list.items.length === 0) {
    return (
      <EmptyState
        icon="search"
        title={`No results for “${query}”`}
        description="Try a different spelling, or browse the World feed for ideas."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2" role="list" aria-label="Search results">
      {type === "users" &&
        (list.items as SearchUser[]).map((u) => <UserRow key={u.id} user={u} />)}
      {type === "posts" &&
        (list.items as Post[]).map((p) => (
          <div key={p.id} role="listitem">
            <PostCard post={p} />
          </div>
        ))}
      {type === "hashtags" &&
        (list.items as HashtagResult[]).map((t) => <HashtagRow key={t.tag} tag={t} />)}
      {type === "companies" &&
        (list.items as CompanySummary[]).map((c) => <CompanyRow key={c.id} company={c} />)}
      {list.loadingMore && (
        <div className="flex justify-center py-4" aria-label="Loading more results">
          <Spinner />
        </div>
      )}
      {list.hasMore && !list.error && <div ref={sentinelRef} aria-hidden className="h-2" />}
    </div>
  );
}

function UserRow({ user }: { user: SearchUser }) {
  return (
    <Link
      href={`/profile/${user.username}`}
      role="listitem"
      className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 transition-colors hover:bg-surface-2"
    >
      <Avatar src={user.avatarUrl} name={user.name} size="md" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-body-sm font-semibold text-ink">{user.name}</span>
          {user.isVerified && (
            <span aria-label="Verified account" className="text-brand-strong">
              <Icon name="check" size={14} />
            </span>
          )}
        </span>
        <span className="block truncate text-caption text-ink-3">@{user.username}</span>
        {user.bio && <span className="mt-0.5 block truncate text-caption text-ink-2">{user.bio}</span>}
      </span>
      <Icon name="chevronRight" size={16} className="shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}

function HashtagRow({ tag }: { tag: HashtagResult }) {
  return (
    <Link
      href={`/hashtag/${encodeURIComponent(tag.tag)}`}
      role="listitem"
      className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 transition-colors hover:bg-surface-2"
    >
      <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand-strong">
        <Icon name="search" size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-semibold text-ink">#{tag.tag}</span>
        <span className="block text-caption text-ink-3">{tag.usageCount} posts</span>
      </span>
      <Icon name="chevronRight" size={16} className="shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}

function CompanyRow({ company }: { company: CompanySummary }) {
  return (
    <Link
      href={`/company/${company.slug}`}
      role="listitem"
      className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 transition-colors hover:bg-surface-2"
    >
      <Avatar src={company.logoUrl} name={company.name} size="md" fallbackIcon="building" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-semibold text-ink">{company.name}</span>
        {company.description && (
          <span className="mt-0.5 block truncate text-caption text-ink-2">{company.description}</span>
        )}
        {company.viewerRole && (
          <span className="mt-0.5 block text-caption text-accent">Your role: {company.viewerRole}</span>
        )}
      </span>
      <Icon name="chevronRight" size={16} className="shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}

function TrendingTags() {
  const [tags, setTags] = useState<HashtagResult[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiGet<{ data: HashtagResult[] }>("/api/hashtags/trending")
      .then((res) => {
        if (!cancelled) setTags(res.data.slice(0, 10));
      })
      .catch(() => {
        if (!cancelled) setTags([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-labelledby="trending-heading">
      <h2 id="trending-heading" className="text-h3 font-bold">
        Trending hashtags
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {tags === null ? (
          [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9 w-24 rounded-full" />)
        ) : tags.length === 0 ? (
          <p className="text-body-sm text-ink-3">Nothing trending yet.</p>
        ) : (
          tags.map((t) => (
            <Link
              key={t.tag}
              href={`/hashtag/${encodeURIComponent(t.tag)}`}
              className="rounded-full border border-line bg-surface px-4 py-2 text-body-sm font-medium text-ink transition-colors hover:border-brand hover:text-brand-strong"
            >
              #{t.tag}
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

export default function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const { q, type } = use(searchParams);
  const validType: SearchType = TYPES.some((t) => t.value === type) ? (type as SearchType) : "users";
  return (
    <Suspense fallback={<LoadingState message="Loading search…" />}>
      <SearchContent initialQ={q?.trim() ?? ""} initialType={validType} />
    </Suspense>
  );
}
