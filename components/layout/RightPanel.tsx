/**
 * components/layout/RightPanel.tsx — desktop right utility rail (xl+).
 * Search shortcut, trending hashtags, active company members, footer links.
 */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, Icon, Skeleton } from "@/components/ui";
import { apiGet, ApiError } from "@/lib/api-client";
import type { HashtagResult } from "@/lib/api-types";
import { SearchBar } from "@/components/search/SearchBar";
import { ActiveCompanyMembers } from "./ActiveCompanyMembers";

export function RightPanel() {
  const [tags, setTags] = useState<HashtagResult[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ data: HashtagResult[] }>("/api/hashtags/trending")
      .then((res) => {
        if (!cancelled) setTags(res.data.slice(0, 8));
      })
      .catch((e) => {
        if (!cancelled && !(e instanceof ApiError)) setTags([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside aria-label="Explore" className="sticky top-4 hidden h-fit w-80 shrink-0 flex-col gap-4 xl:flex">
      <SearchBar compact />

      <Card className="p-4">
        <h2 className="text-h3 font-bold text-ink">Trending now</h2>
        <div className="mt-3 flex flex-col">
          {tags === null ? (
            <div className="flex flex-col gap-3" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : tags.length === 0 ? (
            <p className="py-4 text-center text-body-sm text-ink-3">
              Nothing trending yet — be the first to post.
            </p>
          ) : (
            tags.map((t, i) => (
              <Link
                key={t.tag}
                href={`/hashtag/${encodeURIComponent(t.tag)}`}
                className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2"
              >
                <span aria-hidden className="text-caption font-semibold text-ink-3">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-semibold text-ink group-hover:text-brand-strong">
                    #{t.tag}
                  </span>
                  <span className="block text-caption text-ink-3">
                    {t.usageCount} {t.usageCount === 1 ? "post" : "posts"}
                  </span>
                </span>
                <Icon name="chevronRight" size={16} className="text-ink-3" />
              </Link>
            ))
          )}
        </div>
      </Card>

      {/* Teammates, directly under Trending — the rail is a shortcut panel, and
          "who from my companies is around" is the thing people actually reach
          for while reading the feed. */}
      <ActiveCompanyMembers />

      <nav aria-label="Footer" className="px-2 text-caption text-ink-3">
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          <li><Link href="/help" className="hover:underline">Help</Link></li>
          <li><Link href="/settings" className="hover:underline">Settings</Link></li>
          <li><span>© 2026 AvoMessage</span></li>
        </ul>
      </nav>
    </aside>
  );
}
