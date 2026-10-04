/**
 * The membership cap and the create gate (request: "a user can be in only one
 * company, a manager three, an admin as many as they like, and no user may
 * create a company").
 *
 * These are pure functions of numbers and strings, so every branch is reachable
 * by passing a number — no database, no fixtures. That matters: a cap test that
 * has to arrange global database state breaks the moment another file touches
 * the same table, and "the rule is enforced on all eight membership paths" is
 * only true if the rule itself is unambiguous.
 *
 * The database-backed half — that `POST /api/companies` actually refuses a
 * user, and that the counts really bite at 1/3/∞ — lives in
 * tests/api/company-membership-cap.test.ts. The two files are deliberately
 * separate: this one cannot fail for an environmental reason.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPANY_CREATE_FORBIDDEN,
  COMPANY_LIMIT_REACHED,
  MEMBERSHIP_LIMIT,
  assertCanCreateCompany,
  assertMembershipCapacity,
  canCreateCompany,
  checkMembershipCapacity,
  limitMessageFor,
  membershipLimitFor,
  tierAfterManagerGrant,
  tierFor,
  type MemberTier,
} from '@/lib/services/company-membership-policy';
import { HttpError } from '@/lib/api';

/** Run `fn` and hand back whatever it threw — failing if it threw nothing. */
function thrown(fn: () => void): HttpError {
  try {
    fn();
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error('expected the call to throw, but it returned');
}

describe('the limits themselves', () => {
  it('is 1 for a user, 3 for a manager, unlimited for an admin', () => {
    expect(membershipLimitFor('USER')).toBe(1);
    expect(membershipLimitFor('MANAGER')).toBe(3);
    expect(membershipLimitFor('ADMIN')).toBeNull();
  });

  it('states the same numbers in the exported table', () => {
    // Guards against the function and the table drifting apart.
    for (const tier of ['USER', 'MANAGER', 'ADMIN'] as const) {
      expect(membershipLimitFor(tier)).toBe(MEMBERSHIP_LIMIT[tier]);
    }
  });
});

describe('tierFor', () => {
  it('is ADMIN for both admin platform roles, whatever they manage', () => {
    expect(tierFor('ADMIN', false)).toBe('ADMIN');
    expect(tierFor('ADMIN', true)).toBe('ADMIN');
    expect(tierFor('SUPER_ADMIN', false)).toBe('ADMIN');
    expect(tierFor('SUPER_ADMIN', true)).toBe('ADMIN');
  });

  it('is MANAGER for anyone who administers a company', () => {
    expect(tierFor('USER', true)).toBe('MANAGER');
  });

  it('is USER for everyone else', () => {
    expect(tierFor('USER', false)).toBe('USER');
  });

  it('treats an unrecognised platform role as a plain user', () => {
    // The enum has three values, but a loose string must never widen the cap.
    expect(tierFor('MANAGER', false)).toBe('USER');
    expect(tierFor('', false)).toBe('USER');
    expect(tierFor('admin', false)).toBe('USER');
  });
});

describe('checkMembershipCapacity', () => {
  it('allows any count when the limit is unlimited', () => {
    expect(checkMembershipCapacity(0, null)).toBe('ok');
    expect(checkMembershipCapacity(999, null)).toBe('ok');
  });

  it('allows a count below the limit and refuses at or above it', () => {
    expect(checkMembershipCapacity(0, 1)).toBe('ok');
    expect(checkMembershipCapacity(1, 1)).toBe('LIMIT_REACHED');
    expect(checkMembershipCapacity(2, 1)).toBe('LIMIT_REACHED');

    expect(checkMembershipCapacity(0, 3)).toBe('ok');
    expect(checkMembershipCapacity(1, 3)).toBe('ok');
    expect(checkMembershipCapacity(2, 3)).toBe('ok');
    expect(checkMembershipCapacity(3, 3)).toBe('LIMIT_REACHED');
    expect(checkMembershipCapacity(4, 3)).toBe('LIMIT_REACHED');
  });

  it('uses the tier’s own limit, so the boundary is exactly one short', () => {
    for (const tier of ['USER', 'MANAGER'] as const) {
      const limit = membershipLimitFor(tier)!;
      expect(checkMembershipCapacity(limit - 1, limit)).toBe('ok');
      expect(checkMembershipCapacity(limit, limit)).toBe('LIMIT_REACHED');
    }
  });
});

describe('tierAfterManagerGrant', () => {
  it('promotes a plain user to manager', () => {
    expect(tierAfterManagerGrant('USER')).toBe('MANAGER');
  });

  it('leaves an existing manager or admin where they are', () => {
    expect(tierAfterManagerGrant('MANAGER')).toBe('MANAGER');
    expect(tierAfterManagerGrant('ADMIN')).toBe('ADMIN');
  });

  it('is what makes a promotion possible for someone already in a company', () => {
    // A plain user in their one company is at their cap (1 >= 1). Without the
    // promotion the approval would be refused, and a manager role could only
    // ever be granted to somebody in no company at all.
    expect(checkMembershipCapacity(1, membershipLimitFor('USER'))).toBe('LIMIT_REACHED');
    const after = tierAfterManagerGrant('USER');
    expect(checkMembershipCapacity(1, membershipLimitFor(after))).toBe('ok');
  });
});

describe('canCreateCompany', () => {
  it('refuses a plain user and allows a manager or an admin', () => {
    expect(canCreateCompany('USER')).toBe(false);
    expect(canCreateCompany('MANAGER')).toBe(true);
    expect(canCreateCompany('ADMIN')).toBe(true);
  });
});

describe('assertCanCreateCompany', () => {
  it('throws a 403 COMPANY_CREATE_FORBIDDEN for a user', () => {
    const err = thrown(() => assertCanCreateCompany('USER'));
    expect(err.status).toBe(403);
    expect(err.code).toBe(COMPANY_CREATE_FORBIDDEN);
    expect(err.code).toBe('COMPANY_CREATE_FORBIDDEN');
    // The message has to say what to do instead, not just "forbidden".
    expect(err.message).toMatch(/manager/i);
  });

  it('stays silent for a manager and for an admin', () => {
    expect(() => assertCanCreateCompany('MANAGER')).not.toThrow();
    expect(() => assertCanCreateCompany('ADMIN')).not.toThrow();
  });
});

describe('assertMembershipCapacity', () => {
  it('throws a 409 COMPANY_LIMIT_REACHED when the cap is reached', () => {
    const err = thrown(() => assertMembershipCapacity('USER', 1));
    expect(err.status).toBe(409);
    expect(err.code).toBe(COMPANY_LIMIT_REACHED);
    expect(err.code).toBe('COMPANY_LIMIT_REACHED');
  });

  it('stays silent below the cap, and for an admin at any count', () => {
    expect(() => assertMembershipCapacity('USER', 0)).not.toThrow();
    expect(() => assertMembershipCapacity('MANAGER', 2)).not.toThrow();
    expect(() => assertMembershipCapacity('ADMIN', 500)).not.toThrow();
  });

  it('speaks in the third person when a manager is adding somebody else', () => {
    const self = thrown(() => assertMembershipCapacity('USER', 1, 'self'));
    const other = thrown(() => assertMembershipCapacity('USER', 1, 'other'));
    expect(self.message).toContain('You can');
    expect(other.message).toContain('That person');
    expect(other.message).not.toBe(self.message);
  });
});

describe('limitMessageFor', () => {
  it('is empty for an admin — there is no limit to describe', () => {
    expect(limitMessageFor('ADMIN', 'self')).toBe('');
    expect(limitMessageFor('ADMIN', 'other')).toBe('');
  });

  it('names the number and the subject for both voices', () => {
    expect(limitMessageFor('USER', 'self')).toContain('1 company');
    expect(limitMessageFor('MANAGER', 'self')).toContain('3 companies');
    expect(limitMessageFor('USER', 'other')).toContain('That person');
    expect(limitMessageFor('MANAGER', 'other')).toContain('That person');
    // A manager's ceiling is plural; a user's is singular. Both are visible.
    expect(limitMessageFor('MANAGER', 'other')).toContain('3 companies');
    expect(limitMessageFor('USER', 'other')).toContain('1 company');
  });

  it('returns a non-empty string for every capped tier and voice', () => {
    for (const tier of ['USER', 'MANAGER'] as MemberTier[]) {
      for (const subject of ['self', 'other'] as const) {
        expect(limitMessageFor(tier, subject).length).toBeGreaterThan(0);
      }
    }
  });
});
