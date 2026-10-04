/**
 * Company role labels (request 7).
 *
 * The rule these tests protect: nobody is ever an "owner" in the UI. The
 * `CompanyRole` enum still contains OWNER — it is a Prisma enum and removing a
 * value would mean a destructive migration for no functional gain — so the
 * label layer has to hide it. Both OWNER and MANAGER must render as "Manager",
 * on every surface, forever.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPANY_ROLE_BADGE_VARIANT,
  COMPANY_ROLE_LABEL,
  companyRoleBadgeVariant,
  companyRoleLabel,
  isCompanyManagerRole,
} from '@/lib/company-roles';

describe('companyRoleLabel', () => {
  it('renders MANAGER as "Manager"', () => {
    expect(companyRoleLabel('MANAGER')).toBe('Manager');
  });

  it('renders OWNER as "Manager" — the owner label never reaches the UI', () => {
    expect(companyRoleLabel('OWNER')).toBe('Manager');
  });

  it('renders MEMBER as "Member"', () => {
    expect(companyRoleLabel('MEMBER')).toBe('Member');
  });

  it('never returns the string "Owner" for any known role', () => {
    for (const role of ['OWNER', 'MANAGER', 'MEMBER'] as const) {
      expect(companyRoleLabel(role)).not.toBe('Owner');
    }
  });

  it('falls back to "Member" for loose or missing roles', () => {
    expect(companyRoleLabel('SUPERUSER')).toBe('Member');
    expect(companyRoleLabel('')).toBe('Member');
    expect(companyRoleLabel(null)).toBe('Member');
    expect(companyRoleLabel(undefined)).toBe('Member');
  });
});

describe('companyRoleBadgeVariant', () => {
  it('tints OWNER and MANAGER the same, and MEMBER neutral', () => {
    expect(companyRoleBadgeVariant('OWNER')).toBe('accent');
    expect(companyRoleBadgeVariant('MANAGER')).toBe('accent');
    expect(companyRoleBadgeVariant('MEMBER')).toBe('neutral');
    expect(companyRoleBadgeVariant(undefined)).toBe('neutral');
  });

  it('agrees with the constant map', () => {
    for (const role of ['OWNER', 'MANAGER', 'MEMBER'] as const) {
      expect(companyRoleBadgeVariant(role)).toBe(COMPANY_ROLE_BADGE_VARIANT[role]);
      expect(companyRoleLabel(role)).toBe(COMPANY_ROLE_LABEL[role]);
    }
  });
});

describe('isCompanyManagerRole', () => {
  it('counts a legacy OWNER as a manager, so the rename never costs access', () => {
    expect(isCompanyManagerRole('OWNER')).toBe(true);
    expect(isCompanyManagerRole('MANAGER')).toBe(true);
    expect(isCompanyManagerRole('MEMBER')).toBe(false);
    expect(isCompanyManagerRole(null)).toBe(false);
    expect(isCompanyManagerRole('something-else')).toBe(false);
  });
});
