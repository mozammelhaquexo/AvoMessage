/**
 * lib/company-feed.ts — the ordering rule for the /companies post feed.
 *
 * Pure, and separate from the component on purpose: the component's job is to
 * call the API, and "in what order do these posts come out" is the part that
 * can actually be wrong. This repo has no jsdom, so a `useEffect` that fetches
 * cannot be driven in a test — but this function can, with plain arrays.
 */
import type { Post } from "@/lib/api-types";
import type { PublicCompany } from "@/lib/types";

/** One post, plus the company it came from (for the label above the card). */
export interface CompanyFeedItem {
  post: Post;
  company: PublicCompany;
}

/**
 * Flatten per-company post pages into one feed, newest first.
 *
 * Newest-first is the whole point. A viewer in three companies must not read
 * company A's week-old post above company B's post from an hour ago just
 * because A happened to be fetched first — the fetch order is an artifact of
 * the memberships array, and it should not be visible in the product.
 *
 * Ties break on post id, descending, so the order is total and stable. Without
 * that, two posts sharing a timestamp (very possible: `createdAt` has
 * millisecond resolution and a seed or a test can write several at once) would
 * keep swapping places between renders, which React would report as unstable
 * keys.
 *
 * `createdAt` is an ISO-8601 string, so a lexicographic compare is the same as
 * a chronological one and needs no `Date` allocation per comparison.
 */
export function mergeCompanyFeed(lists: CompanyFeedItem[][]): CompanyFeedItem[] {
  return lists.flat().sort((a, b) => {
    if (a.post.createdAt !== b.post.createdAt) {
      return a.post.createdAt < b.post.createdAt ? 1 : -1;
    }
    if (a.post.id !== b.post.id) return a.post.id < b.post.id ? 1 : -1;
    return 0;
  });
}
