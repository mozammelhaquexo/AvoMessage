/**
 * The Companies section for someone who is not in a company (request: "no user
 * can create a company; only a manager adds them — and show them a nicely
 * designed Bengali message telling them to contact their manager").
 *
 * Three separate claims, which is why this file is not just a snapshot:
 *
 *   1. the empty state is CHOSEN correctly — a plain user with no company gets
 *      the Bengali "ask your manager" state, a manager with no company gets an
 *      invitation to create one, and a search that matches nothing gets neither;
 *   2. the Bengali copy is the copy that was asked for, verbatim, with the
 *      English line underneath;
 *   3. the create button is not rendered at all for a viewer who may not create
 *      one — not disabled, not hidden with CSS, absent from the markup. A
 *      hidden-but-present control is still an offer.
 *
 * `CompaniesDirectory` is a client component that fetches its rows, so its
 * EMPTY state is not reachable through `renderToStaticMarkup` (the effect never
 * runs). That is exactly why `companiesEmptyKind` is a separate function: the
 * decision is tested here, and the two states that ARE synchronous — the header
 * and its button — are asserted from the rendered markup.
 *
 * Renders in the default node environment via react-dom/server, like the rest
 * of the component tests here — no jsdom, no testing-library.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * `CompaniesDirectory` calls `useRouter()`, which asserts an app-router
 * context that does not exist outside Next's runtime. Only the router is
 * stubbed — the component, the UI primitives and the copy under test are the
 * real ones.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    back: () => undefined,
    refresh: () => undefined,
    prefetch: () => undefined,
  }),
}));

import { CompaniesDirectory, companiesEmptyKind } from '@/components/companies/CompaniesDirectory';
import { NoCompanyYet } from '@/components/companies/NoCompanyYet';

/**
 * The visible text of a rendered tree.
 *
 * Substring checks against raw markup are unreliable in two ways that matter
 * here: React separates adjacent text expressions with `<!-- -->`, and class
 * names are arbitrary strings. Both make a naive `toContain('2 of 3')` fail (or
 * pass) for the wrong reason, so the assertions read the text.
 */
function text(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('companiesEmptyKind', () => {
  it('gives a plain user with no company the "ask your manager" state', () => {
    expect(companiesEmptyKind({ query: '', canCreateCompany: false })).toBe('no-company-yet');
  });

  it('offers creation to someone who may create', () => {
    expect(companiesEmptyKind({ query: '', canCreateCompany: true })).toBe('can-create');
  });

  it('a search that matches nothing is a no-match, whoever is looking', () => {
    // Both viewers, so the branch cannot accidentally depend on the gate.
    expect(companiesEmptyKind({ query: 'zzz', canCreateCompany: false })).toBe('no-match');
    expect(companiesEmptyKind({ query: 'zzz', canCreateCompany: true })).toBe('no-match');
  });

  it('whitespace is not a search', () => {
    expect(companiesEmptyKind({ query: '   ', canCreateCompany: false })).toBe('no-company-yet');
  });
});

describe('NoCompanyYet — the Bengali empty state', () => {
  const html = renderToStaticMarkup(<NoCompanyYet />);

  it('says the company has not been added, in Bengali', () => {
    expect(html).toContain('আপনাকে এখনো কোনো কোম্পানিতে যোগ করা হয়নি');
  });

  it('tells them to contact their manager', () => {
    expect(html).toContain('আপনার ম্যানেজারের সাথে যোগাযোগ করুন');
  });

  it('says what they will see once they are added', () => {
    expect(html).toContain('যোগ হওয়ার পর');
  });

  it('carries an English line too, so the state is readable either way', () => {
    expect(html).toContain('Not in a company yet');
  });

  it('offers nothing to click — there is no action for them to take', () => {
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<a ');
  });

  it('renders in both the page and the compact card shape', () => {
    const compact = renderToStaticMarkup(<NoCompanyYet compact />);
    expect(compact).toContain('আপনাকে এখনো কোনো কোম্পানিতে যোগ করা হয়নি');
  });
});

describe('CompaniesDirectory — the create button follows the gate', () => {
  it('renders no create button for a viewer who may not create', () => {
    const html = renderToStaticMarkup(
      <CompaniesDirectory canCreateCompany={false} membership={{ tier: 'USER', limit: 1, current: 0 }} />,
    );
    expect(html).not.toContain('New company');
    expect(html).not.toContain('/companies/new');
  });

  it('renders the create button for a viewer who may', () => {
    const html = renderToStaticMarkup(
      <CompaniesDirectory
        canCreateCompany
        membership={{ tier: 'MANAGER', limit: 3, current: 1 }}
      />,
    );
    expect(html).toContain('New company');
    expect(html).toContain('/companies/new');
  });

  it('states a capped viewer’s usage so a refusal is never a surprise', () => {
    const manager = renderToStaticMarkup(
      <CompaniesDirectory
        canCreateCompany
        membership={{ tier: 'MANAGER', limit: 3, current: 2 }}
      />,
    );
    expect(text(manager)).toContain('2 of 3 companies');

    const user = renderToStaticMarkup(
      <CompaniesDirectory canCreateCompany={false} membership={{ tier: 'USER', limit: 1, current: 1 }} />,
    );
    // Singular for a ceiling of one.
    expect(text(user)).toContain('1 of 1 company');
  });

  it('says nothing about a cap when there is none', () => {
    const admin = renderToStaticMarkup(
      <CompaniesDirectory canCreateCompany membership={{ tier: 'ADMIN', limit: null, current: 9 }} />,
    );
    // "unlimited" is not worth a line of text — and "9 of null" would be worse.
    expect(text(admin)).not.toMatch(/\d+ of \d+/);
    expect(text(admin)).not.toContain('null');
  });
});
