/**
 * Identity chips (features 1/2/8): Admin + Manager + company badges.
 *
 * These are pure presentational components, so they render in the default
 * node environment via react-dom/server — no jsdom or testing-library needed.
 * The point of these assertions is the *rule*, not the pixel: a plain user
 * must render nothing, an OWNER/MANAGER must be labelled Manager, and an
 * ADMIN must be labelled Admin.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CompanyBadge,
  RoleBadge,
  UserBadges,
  isAdminRole,
  isManagerRole,
} from '@/components/ui/user-badges';

describe('role predicates', () => {
  it('treats ADMIN and SUPER_ADMIN as admin', () => {
    expect(isAdminRole('ADMIN')).toBe(true);
    expect(isAdminRole('SUPER_ADMIN')).toBe(true);
    expect(isAdminRole('USER')).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });

  it('treats OWNER and MANAGER as manager, MEMBER not', () => {
    expect(isManagerRole(['MANAGER'])).toBe(true);
    expect(isManagerRole(['OWNER'])).toBe(true);
    expect(isManagerRole(['MEMBER'])).toBe(false);
    expect(isManagerRole([])).toBe(false);
    expect(isManagerRole(null)).toBe(false);
  });
});

describe('RoleBadge', () => {
  it('renders nothing for a plain user', () => {
    expect(renderToStaticMarkup(<RoleBadge platformRole="USER" companyRoles={['MEMBER']} />)).toBe('');
  });

  it('renders an Admin chip for ADMIN', () => {
    const html = renderToStaticMarkup(<RoleBadge platformRole="ADMIN" />);
    expect(html).toContain('Admin');
    expect(html).toContain('bg-amber-500/15');
  });

  it('renders a Super Admin chip for SUPER_ADMIN', () => {
    expect(renderToStaticMarkup(<RoleBadge platformRole="SUPER_ADMIN" />)).toContain('Super Admin');
  });

  it('renders a Manager chip for a company OWNER', () => {
    const html = renderToStaticMarkup(<RoleBadge companyRoles={['OWNER']} />);
    expect(html).toContain('Manager');
    expect(html).toContain('bg-violet-500/15');
  });

  it('renders both chips when a platform admin also manages a company', () => {
    const html = renderToStaticMarkup(
      <RoleBadge platformRole="ADMIN" companyRoles={['MANAGER']} />,
    );
    expect(html).toContain('Admin');
    expect(html).toContain('Manager');
  });
});

describe('CompanyBadge', () => {
  it('names the company the user belongs to', () => {
    const html = renderToStaticMarkup(<CompanyBadge name="Avocado Labs" role="MANAGER" />);
    expect(html).toContain('Avocado Labs');
    expect(html).toContain('Member of Avocado Labs (manager)');
  });
});

describe('UserBadges', () => {
  it('renders role + company chips together', () => {
    const html = renderToStaticMarkup(
      <UserBadges
        platformRole="USER"
        companies={[{ name: 'Avocado Labs', slug: 'avocado-labs', role: 'MANAGER' }]}
      />,
    );
    expect(html).toContain('Manager');
    expect(html).toContain('Avocado Labs');
  });

  it('caps company chips and collapses the rest into +N', () => {
    const html = renderToStaticMarkup(
      <UserBadges
        platformRole="USER"
        maxCompanies={1}
        companies={[
          { name: 'Alpha', slug: 'alpha', role: 'MANAGER' },
          { name: 'Beta', slug: 'beta', role: 'MEMBER' },
          { name: 'Gamma', slug: 'gamma', role: 'MEMBER' },
        ]}
      />,
    );
    expect(html).toContain('Member of Alpha');
    // Beta/Gamma get no chip of their own — they are only named in the +N
    // tooltip, so assert on the chip label rather than the raw markup.
    expect(html).not.toContain('Member of Beta');
    expect(html).toContain('+2');
    expect(html).toContain('title="Beta, Gamma"');
  });

  it('omits company chips when showCompanies is false but keeps the role chip', () => {
    const html = renderToStaticMarkup(
      <UserBadges
        platformRole="ADMIN"
        showCompanies={false}
        companies={[{ name: 'Avocado Labs', slug: 'avocado-labs', role: 'MANAGER' }]}
      />,
    );
    expect(html).toContain('Admin');
    expect(html).not.toContain('Avocado Labs');
  });
});
