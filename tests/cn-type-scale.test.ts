/**
 * `cn()` must not eat the project's own type scale.
 *
 * The bug this guards against: tailwind-merge only knows Tailwind's built-in
 * sizes. This project declares its own in `app/globals.css` (`@theme`):
 * display, h1, h2, h3, body-sm, caption, tiny. An unrecognised `text-*` token
 * is treated as a text *colour*, so combining a size with a colour silently
 * deleted the size:
 *
 *     cn("text-tiny", "text-amber-700")   // was: "text-amber-700"
 *
 * No warning, no error — the class just left the DOM, nothing set a font-size,
 * and the element fell back to 16px. Measured live: the "Super Admin" chip on
 * a post rendered at 16px beside a 14px author name, i.e. the badge was larger
 * than the name it labelled.
 *
 * Two layers here:
 *   1. the merge itself, on the exact shapes that broke;
 *   2. a sweep of every `cn()` call in the source, so a new call site that
 *      pairs a custom size with a colour fails the build rather than shipping.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cn } from '@/components/ui/utils';

/** Mirrors the `--text-*` tokens in app/globals.css `@theme`. */
const CUSTOM_SIZES = ['display', 'h1', 'h2', 'h3', 'body-sm', 'caption', 'tiny'] as const;

/**
 * `text-tiny`, `sm:text-caption`, … — captures the token.
 *
 * The breakpoint prefix must be optional as a whole. `(?:sm|md|lg):?text-…`
 * demands one of them and then matches nothing, which is how a first pass at
 * this scan reported a cheerful zero.
 */
const sizeRe = () =>
  new RegExp(
    `(?:^|[\\s:])(?:(?:sm|md|lg|xl|2xl):)?text-(${CUSTOM_SIZES.join('|')})(?![\\w-])`,
    'g',
  );

function sizesIn(text: string): Set<string> {
  return new Set([...text.matchAll(sizeRe())].map((m) => m[1]));
}

describe('cn() and the custom type scale', () => {
  it('keeps a custom size when a text colour follows it', () => {
    expect(cn('text-tiny', 'text-amber-700')).toBe('text-tiny text-amber-700');
    expect(cn('text-caption', 'text-ink-3')).toBe('text-caption text-ink-3');
    expect(cn('text-body-sm', 'text-ink')).toBe('text-body-sm text-ink');
    expect(cn('text-h2', 'text-ink')).toBe('text-h2 text-ink');
  });

  it('keeps the size when it is buried in a shared constant, as CHIP is', () => {
    const chip =
      'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-tiny font-semibold uppercase leading-none tracking-wide';
    const merged = cn(chip, 'bg-amber-500/15 text-amber-700 dark:text-amber-300');
    expect(merged).toContain('text-tiny');
    expect(merged).toContain('text-amber-700');
    expect(merged).toContain('dark:text-amber-300');
  });

  it('still resolves a genuine size conflict to the last one', () => {
    expect(cn('text-sm', 'text-lg')).toBe('text-lg');
    expect(cn('text-tiny', 'text-caption')).toBe('text-caption');
  });

  it('still resolves a genuine colour conflict to the last one', () => {
    expect(cn('text-ink-2', 'text-danger')).toBe('text-danger');
    expect(cn('text-ink-2', 'hover:text-ink')).toBe('text-ink-2 hover:text-ink');
  });

  it('leaves arbitrary values and built-in sizes alone', () => {
    expect(cn('text-[13px]', 'text-ink')).toBe('text-[13px] text-ink');
    expect(cn('text-sm', 'text-amber-700')).toBe('text-sm text-amber-700');
  });
});

/** Every .ts/.tsx under a directory, skipping build and vendor output. */
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Balanced-paren extraction of every `cn(` call body in a file. */
function cnCallBodies(src: string): { body: string; index: number }[] {
  const bodies: { body: string; index: number }[] = [];
  const re = /\bcn\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length;
    let depth = 1;
    let quote: string | null = null;
    const start = i;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (quote) {
        if (ch === '\\') i += 1;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      i += 1;
    }
    bodies.push({ body: src.slice(start, i - 1), index: m.index });
  }
  return bodies;
}

/**
 * Module-scope string constants.
 *
 * Load-bearing: the custom size usually lives in a shared constant (CHIP in
 * user-badges.tsx) while the colour is written inline at the call site, so a
 * sweep that reads only the literals inside `cn(...)` sees the colour and
 * never the size — and reports zero problems.
 */
function stringConstants(src: string): Map<string, string> {
  const map = new Map<string, string>();
  const re =
    /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*(["'`])((?:\\.|(?!\2)[^\\])*)\2\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) map.set(m[1], m[3]);
  return map;
}

/**
 * Split a call body at its top-level commas.
 *
 * Nested `(`, `[`, `{` and string literals are tracked so that a comma inside
 * `f(a, b)` or inside "a, b" does not split the argument.
 */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/**
 * The alternative class-strings an argument can contribute.
 *
 * `compact ? "text-body-sm" : "text-h3"` yields two alternatives, never both —
 * merging them together would look like a size conflict that cannot happen at
 * runtime. Without this the sweep reports false positives on every ternary.
 */
function alternatives(arg: string): string[] {
  let depth = 0;
  let quote: string | null = null;
  let q = -1;
  let colon = -1;
  for (let i = 0; i < arg.length; i += 1) {
    const ch = arg[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (depth === 0 && ch === '?' && arg[i + 1] !== '.' && q === -1) q = i;
    else if (depth === 0 && ch === ':' && q !== -1 && colon === -1 && arg[i + 1] !== ':') colon = i;
  }
  if (q === -1 || colon === -1) return [arg];
  return [
    ...alternatives(arg.slice(q + 1, colon)),
    ...alternatives(arg.slice(colon + 1)),
  ];
}

/** Every class-string combination the call can actually produce. */
function combinations(body: string): string[][] {
  let combos: string[][] = [[]];
  for (const arg of splitTopLevel(body)) {
    const next: string[][] = [];
    for (const combo of combos) {
      for (const alt of alternatives(arg)) next.push([...combo, alt]);
    }
    combos = next;
  }
  return combos;
}

describe('cn() call sites in the source', () => {
  it('never drops a custom font size', () => {
    const root = process.cwd();
    const files = [
      ...walk(join(root, 'components')),
      ...walk(join(root, 'app')),
      ...walk(join(root, 'lib')),
    ];
    expect(files.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    let callsWithSize = 0;

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const consts = stringConstants(src);

      for (const { body, index } of cnCallBodies(src)) {
        for (const combo of combinations(body)) {
          // Swap bare identifiers for their constant value, then take the
          // string literals — that is what `cn` will actually receive.
          const resolved = combo.join(',').replace(/\b([A-Za-z_$][\w$]*)\b/g, (whole, name: string) => {
            const value = consts.get(name);
            return value === undefined ? whole : `"${value}"`;
          });
          const literals = [...resolved.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(
            (m) => m[2],
          );
          if (literals.length === 0) continue;

          const incoming = sizesIn(literals.join(' '));
          if (incoming.size === 0) continue;
          callsWithSize += 1;

          const outgoing = sizesIn(cn(...literals));
          const lost = [...incoming].filter((s) => !outgoing.has(s));
          if (lost.length > 0) {
            const line = src.slice(0, index).split('\n').length;
            offenders.push(
              `${relative(root, file).replace(/\\/g, '/')}:${line} lost ${lost.join(', ')}`,
            );
          }
        }
      }
    }

    // A sweep that finds nothing to look at is not a passing sweep.
    expect(callsWithSize).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });
});
