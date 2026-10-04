/**
 * The ordering rule for the /companies post feed.
 *
 * The product rule this encodes: the company system lives in the Companies
 * section, and a viewer in several companies reads ONE feed — not one feed per
 * company in whatever order the memberships happened to arrive.
 *
 * `mergeCompanyFeed` is pure precisely so this can be asserted with plain
 * arrays. The component around it only fetches; there is no jsdom here to drive
 * a `useEffect` with, and the part that can be wrong is the sort.
 */
import { describe, expect, it } from 'vitest';
import { mergeCompanyFeed, type CompanyFeedItem } from '@/lib/company-feed';
import type { Post } from '@/lib/api-types';
import type { PublicCompany } from '@/lib/types';

/** A company fixture — only the fields the feed reads matter. */
function company(id: string, name: string): PublicCompany {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    logoUrl: null,
    coverUrl: null,
    brandColor: null,
    description: null,
    website: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

/** A post fixture — `createdAt` is the only field the sort reads. */
function post(id: string, createdAt: string): Post {
  return {
    id,
    body: `post ${id}`,
    visibility: 'COMPANY',
    companyId: 'c',
    author: {
      id: 'u1',
      name: 'Mozammel Haque',
      username: 'mozammelhaquexo',
      avatarUrl: null,
      isVerified: true,
    },
    media: [],
    counts: { likes: 0, comments: 0, shares: 0 },
    viewerState: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function item(id: string, createdAt: string, c: PublicCompany): CompanyFeedItem {
  return { post: post(id, createdAt), company: c };
}

const AVOCADO = company('c1', 'Avocado Labs');
const GREENHOUSE = company('c2', 'Greenhouse Studio');

describe('mergeCompanyFeed', () => {
  it('is empty when there is nothing to merge', () => {
    expect(mergeCompanyFeed([])).toEqual([]);
    expect(mergeCompanyFeed([[], []])).toEqual([]);
  });

  it('keeps every post from every company', () => {
    const merged = mergeCompanyFeed([
      [item('a', '2026-10-01T10:00:00.000Z', AVOCADO)],
      [
        item('b', '2026-10-01T11:00:00.000Z', GREENHOUSE),
        item('c', '2026-10-01T12:00:00.000Z', GREENHOUSE),
      ],
    ]);
    expect(merged.map((i) => i.post.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('orders across companies by time, not by which company was fetched first', () => {
    // Avocado is listed FIRST but its post is the OLDEST. If the merge were a
    // plain concat, `a` would lead — which is the bug this rule exists to stop.
    const merged = mergeCompanyFeed([
      [item('old', '2026-10-01T09:00:00.000Z', AVOCADO)],
      [item('new', '2026-10-01T18:00:00.000Z', GREENHOUSE)],
    ]);
    expect(merged.map((i) => i.post.id)).toEqual(['new', 'old']);
  });

  it('puts the newest post of the newest company first, even when companies interleave', () => {
    const merged = mergeCompanyFeed([
      [
        item('a1', '2026-10-01T08:00:00.000Z', AVOCADO),
        item('a3', '2026-10-01T20:00:00.000Z', AVOCADO),
      ],
      [
        item('b1', '2026-10-01T12:00:00.000Z', GREENHOUSE),
        item('b2', '2026-10-01T22:00:00.000Z', GREENHOUSE),
      ],
    ]);
    expect(merged.map((i) => i.post.id)).toEqual(['b2', 'a3', 'b1', 'a1']);
  });

  it('carries each post’s own company, so the label above a card is right', () => {
    const merged = mergeCompanyFeed([
      [item('a', '2026-10-01T09:00:00.000Z', AVOCADO)],
      [item('b', '2026-10-01T10:00:00.000Z', GREENHOUSE)],
    ]);
    expect(merged[0]!.company.name).toBe('Greenhouse Studio');
    expect(merged[1]!.company.name).toBe('Avocado Labs');
  });

  it('breaks a timestamp tie on id, descending, so the order never wobbles', () => {
    // Same instant — which happens whenever a test or a seed writes several
    // posts at once. An unstable comparator would let these swap between
    // renders and React would call the keys unstable.
    const same = '2026-10-01T10:00:00.000Z';
    const merged = mergeCompanyFeed([
      [item('aaa', same, AVOCADO)],
      [item('zzz', same, GREENHOUSE)],
    ]);
    expect(merged.map((i) => i.post.id)).toEqual(['zzz', 'aaa']);

    // And the same result when the inputs arrive the other way round.
    const reversed = mergeCompanyFeed([
      [item('zzz', same, GREENHOUSE)],
      [item('aaa', same, AVOCADO)],
    ]);
    expect(reversed.map((i) => i.post.id)).toEqual(['zzz', 'aaa']);
  });

  it('does not mutate the pages it was given', () => {
    const pageA = [item('a', '2026-10-01T09:00:00.000Z', AVOCADO)];
    const pageB = [item('b', '2026-10-01T10:00:00.000Z', GREENHOUSE)];
    mergeCompanyFeed([pageA, pageB]);
    expect(pageA.map((i) => i.post.id)).toEqual(['a']);
    expect(pageB.map((i) => i.post.id)).toEqual(['b']);
  });
});
