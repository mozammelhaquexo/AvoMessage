/**
 * Console palette search (feature 12).
 *
 * The palette is the one part of the toolbar with real logic — "what does
 * typing this find?" — so it lives in `lib/console-nav.ts` and is tested here
 * rather than through a rendered component (there is no jsdom in this repo, and
 * `next/navigation`'s `useRouter` cannot be called outside a mounted router).
 */
import { describe, expect, it } from 'vitest';
import { matchSections } from '@/lib/console-nav';

const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', keywords: ['overview', 'stats'] },
  { id: 'users', label: 'Users', keywords: ['accounts'] },
  { id: 'reports', label: 'Reports', keywords: ['abuse', 'flag'] },
  { id: 'roles', label: 'Roles', keywords: ['permissions'] },
];

/**
 * A fixture built for the ordering question: `zulu` is a keyword on the first
 * and third entries only, so the result is non-adjacent and any re-ranking
 * would be visible.
 */
const ORDERED = [
  { id: 'a', label: 'Alpha', keywords: ['zulu'] },
  { id: 'b', label: 'Bravo' },
  { id: 'c', label: 'Charlie', keywords: ['zulu'] },
  { id: 'd', label: 'Delta' },
];

describe('matchSections', () => {
  it('returns the leading sections for an empty query', () => {
    expect(matchSections(SECTIONS, '').map((s) => s.id)).toEqual([
      'dashboard',
      'users',
      'reports',
      'roles',
    ]);
  });

  it('treats a whitespace-only query as empty', () => {
    expect(matchSections(SECTIONS, '   ')).toHaveLength(4);
  });

  it('matches a label case-insensitively', () => {
    expect(matchSections(SECTIONS, 'REP').map((s) => s.id)).toEqual(['reports']);
  });

  it('matches a substring in the middle of a label', () => {
    expect(matchSections(SECTIONS, 'shbo').map((s) => s.id)).toEqual(['dashboard']);
  });

  it('matches keywords as well as labels', () => {
    expect(matchSections(SECTIONS, 'abuse').map((s) => s.id)).toEqual(['reports']);
    expect(matchSections(SECTIONS, 'accounts').map((s) => s.id)).toEqual(['users']);
  });

  it('preserves nav order rather than ranking by relevance', () => {
    expect(matchSections(ORDERED, 'zulu').map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('returns nothing when there is no match', () => {
    expect(matchSections(SECTIONS, 'zzz')).toEqual([]);
  });

  it('honours the limit', () => {
    expect(matchSections(ORDERED, '', 2).map((s) => s.id)).toEqual(['a', 'b']);
    expect(matchSections(ORDERED, 'zulu', 1).map((s) => s.id)).toEqual(['a']);
  });

  it('handles a section with no keywords', () => {
    expect(matchSections([{ label: 'Settings' }], 'sett')).toEqual([{ label: 'Settings' }]);
  });

  it('handles an empty section list', () => {
    expect(matchSections([], 'anything')).toEqual([]);
  });
});
