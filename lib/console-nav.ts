/**
 * lib/console-nav.ts — pure search for the Admin/Manager console palettes.
 *
 * Kept out of the component so the rule ("what does typing `rep` match?") can
 * be unit tested without a router or a DOM. The component only renders what
 * this returns.
 */

export interface SearchableSection {
  label: string;
  /** Extra terms that should match, e.g. "abuse" for the Reports section. */
  keywords?: string[];
}

/**
 * Filter console sections by a free-text query.
 *
 * - Matching is a case-insensitive substring test against the label and every
 *   keyword, so `rep` finds both "Reports" and a section keyworded "report".
 * - Input order is preserved (the nav order), which keeps results predictable
 *   — a relevance score would reshuffle the list on every keystroke.
 * - An empty or whitespace-only query returns the first `limit` sections, so
 *   the palette opens useful instead of blank.
 */
export function matchSections<T extends SearchableSection>(
  sections: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const q = query.trim().toLowerCase();
  if (q === "") return sections.slice(0, limit);
  const hits: T[] = [];
  for (const section of sections) {
    const label = section.label.toLowerCase();
    if (label.includes(q) || section.keywords?.some((k) => k.toLowerCase().includes(q))) {
      hits.push(section);
      if (hits.length === limit) break;
    }
  }
  return hits;
}
