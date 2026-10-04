/**
 * components/companies/tabs/CompanyMediaTab.tsx — company workspace Media tab.
 *
 * Renders a grid of photos/videos attached to company posts. The company-posts
 * API now returns full post objects with `media`, so this tab is backed by
 * real data (previously an honest placeholder).
 */
"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";
import { EmptyState, LoadingState } from "@/components/ui";
import type { Post, PostMedia } from "@/lib/api-types";
import type { Paginated } from "@/lib/types";

export function CompanyMediaTab({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<PostMedia[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Paginated<Post>>(`/api/companies/${companyId}/posts`, { params: { limit: 50 } })
      .then((r) => setItems(r.data.flatMap((p) => p.media ?? [])))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [companyId]);

  if (loading) return <LoadingState message="Loading media…" />;
  if (items.length === 0) {
    return (
      <div className="py-4">
        <EmptyState
          icon="image"
          title="No media yet"
          description="Photos and videos shared in company posts will appear here."
        />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 py-4 sm:grid-cols-3">
      {items.map((m) =>
        m.kind === "VIDEO" || m.kind === "video" ? (
          <video
            key={m.id}
            src={m.url}
            controls
            preload="metadata"
            className="aspect-square w-full rounded-lg object-cover"
            aria-label="Company post video"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={m.id} src={m.url} alt="" className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
        ),
      )}
    </div>
  );
}
