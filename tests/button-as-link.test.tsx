/**
 * `Button` can render as a link — and the app's CTAs are no longer invalid HTML.
 *
 * The shape this replaces: `<Link href="/signup"><Button>Sign up</Button></Link>`,
 * which emits `<a><button>`. It looks correct with a mouse, but the inner button
 * takes focus, so Enter activates the button — which has no handler — and the
 * link can never be followed from the keyboard. Twelve CTAs had that shape,
 * including every button on the public landing page.
 *
 * Pure presentational component, so it renders through react-dom/server with no
 * jsdom — same approach as tests/user-badges.test.tsx.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '@/components/ui/button';

const render = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('Button as a link', () => {
  it('renders a single <a href> when given href — never an <a> wrapping a <button>', () => {
    const html = render(<Button href="/signup">Sign up</Button>);
    expect(html).toMatch(/^<a[^>]*href="\/signup"/);
    expect(html).not.toContain('<button');
    expect(html).toContain('Sign up');
  });

  it('carries the same visual classes as the button form', () => {
    const asLink = render(<Button href="/signup" variant="outline" size="lg">Go</Button>);
    const asButton = render(<Button variant="outline" size="lg">Go</Button>);
    // Same size and variant tokens, whatever order they land in.
    for (const token of ['h-12', 'px-6', 'border-line-strong', 'inline-flex']) {
      expect(asLink, `link is missing ${token}`).toContain(token);
      expect(asButton, `button is missing ${token}`).toContain(token);
    }
  });

  it('does not put a button-only `type` attribute on the anchor', () => {
    const html = render(<Button href="/login">Log in</Button>);
    expect(html).not.toMatch(/<a[^>]*\stype=/);
  });

  it('expresses disabled the only way an anchor can', () => {
    const html = render(<Button href="/login" disabled>Log in</Button>);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('tabindex="-1"');
    // `disabled` is not a valid anchor attribute and must not be emitted as
    // one. (`aria-disabled` and the `disabled:` utility classes are fine.)
    expect(html).not.toMatch(/\sdisabled=/);
  });

  it('still renders a real <button> when href is absent', () => {
    const html = render(<Button>Plain</Button>);
    expect(html).toMatch(/^<button[^>]*type="button"/);
    expect(html).not.toContain('<a ');
  });
});

describe('no invalid interactive nesting is left in the app', () => {
  it('has no <Link> directly wrapping a <Button>', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const root = process.cwd();

    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (full.endsWith('.tsx')) out.push(full);
      }
      return out;
    };

    const offenders: string[] = [];
    for (const dir of ['components', 'app']) {
      for (const file of walk(join(root, dir))) {
        // components/ui/button.tsx documents the pattern it replaces.
        if (file.endsWith(join('ui', 'button.tsx'))) continue;
        const src = readFileSync(file, 'utf8');
        const m = /<Link\b[^>]*>\s*<Button\b/.exec(src);
        if (m) {
          offenders.push(`${relative(root, file).replace(/\\/g, '/')}:${src.slice(0, m.index).split('\n').length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
