/**
 * The OWNER company role is retired from the product (request 7).
 *
 * `tests/company-roles.test.ts` proves the mapping — `companyRoleLabel` turns
 * OWNER and MANAGER into "Manager" and can never return "Owner". That covers
 * every display site, because every display site goes through it.
 *
 * This file guards the other half: the literal string, written by hand. A
 * `<Badge>Owner</Badge>` or a `role === "OWNER" ? "Owner" : …` would slip past
 * the mapping tests entirely, because it never calls the mapping. So scan the
 * sources and fail if the word appears anywhere a user could read it.
 *
 * Two other enums also carry an OWNER value and are NOT this rule's business:
 *   - `ConversationRole.OWNER` — a group chat's creator. Never rendered; it is
 *     only ever compared (`ChatWindow.tsx`). Left alone.
 *   - `TeamRole` — MANAGER | MEMBER only, no owner at all.
 * So the enum-level assertions below are scoped to `.tsx` files, where a company
 * role could actually reach the screen, and the title-case assertions cover the
 * whole source tree.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

/** Strip line comments, block comments and JSX comments, keeping line numbers. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

function walk(dir: string, extensions: string[], out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, extensions, out);
    else if (extensions.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}

/** Every non-comment line under `dirs` that matches `pattern`. */
function offenders(dirs: string[], extensions: string[], pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const dir of dirs) {
    for (const file of walk(join(ROOT, dir), extensions)) {
      const code = withoutComments(readFileSync(file, 'utf8'));
      code.split('\n').forEach((line, i) => {
        if (pattern.test(line)) {
          hits.push(`${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}: ${line.trim()}`);
        }
      });
    }
  }
  return hits;
}

describe('the word "Owner" never reaches the screen', () => {
  it('is not written as a title-case literal outside comments', () => {
    // "Owner" / "Owner's" / "owners" / "ownership" as a human-readable word.
    // The enum value is upper-case, so this catches hand-written labels
    // specifically — including one added to the label map itself.
    expect(offenders(['components', 'app', 'lib'], ['.ts', '.tsx'], /\bOwner(?:'s|s|ship)?\b/)).toEqual([]);
  });

  it('is not rendered as JSX text or a JSX string child', () => {
    const asJsxText = offenders(['components', 'app'], ['.tsx'], />\s*OWNER\s*</);
    const asStringChild = offenders(['components', 'app'], ['.tsx'], /\{\s*["'`]OWNER["'`]\s*\}/);
    expect([...asJsxText, ...asStringChild]).toEqual([]);
  });

  it('appears as the OWNER enum in .tsx only in comparisons, type positions or data', () => {
    // Every remaining hit must be one of the sanctioned shapes. If a new shape
    // shows up this fails, and a human decides whether it is legitimate — which
    // is the point: the role may be read from the database, never displayed.
    const sanctioned = [
      /===\s*["']OWNER["']/,
      /!==\s*["']OWNER["']/,
      /["']OWNER["']\s*===/,
      /["']OWNER["']\s*!==/,
      /["']OWNER["']\s*[|)]/,
      /[|(]\s*["']OWNER["']/,
      /role:\s*["']OWNER["']/, // a DB write, not a render
      /CompanyRole/,
    ];
    const hits = offenders(['components', 'app'], ['.tsx'], /\bOWNER\b/).filter(
      (line) => !sanctioned.some((p) => p.test(line)),
    );
    expect(hits).toEqual([]);
  });
});
