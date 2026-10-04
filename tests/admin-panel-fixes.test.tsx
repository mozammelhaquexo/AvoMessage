/**
 * Regression tests for the admin-panel defects found in the audit.
 *
 * Each block pins one bug that was fixed, and states the symptom so a future
 * reader knows what they would break by reverting it. These are the parts of the
 * fix that are pure — the render branches that need a live fetch are covered by
 * the browser probe in scripts/.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Avatar } from '@/components/ui/avatar';
import { stripAnnouncementTitle } from '@/lib/services/serialize';
import { adminUserUpdateSchema } from '@/lib/validation';

describe('stripAnnouncementTitle', () => {
  /**
   * A platform announcement is a Post, and a Post has no title column, so the
   * title is stored as the first line of the body. The admin console renders the
   * title from its own field, so without stripping the prefix the title showed
   * up twice.
   */
  it('removes the title prefix the create path wrote', () => {
    expect(stripAnnouncementTitle('Scheduled maintenance\n\nTonight at 22:00.', 'Scheduled maintenance')).toBe(
      'Tonight at 22:00.',
    );
  });

  it('leaves a body that never had the prefix alone', () => {
    expect(stripAnnouncementTitle('Tonight at 22:00.', 'Scheduled maintenance')).toBe('Tonight at 22:00.');
  });

  it('leaves the body alone when there is no title', () => {
    expect(stripAnnouncementTitle('Just a body', null)).toBe('Just a body');
    expect(stripAnnouncementTitle('Just a body', undefined)).toBe('Just a body');
    expect(stripAnnouncementTitle('Just a body', '')).toBe('Just a body');
  });

  it('only strips a whole-line prefix, not a coincidental match', () => {
    // The title appears mid-body: nothing to strip, the line is real content.
    expect(stripAnnouncementTitle('Note: maintenance\n\nMore', 'maintenance')).toBe('Note: maintenance\n\nMore');
    // Prefix present but not followed by the blank line the create path writes.
    expect(stripAnnouncementTitle('maintenance tonight', 'maintenance')).toBe('maintenance tonight');
  });

  it('treats the title as literal text, not a pattern', () => {
    // Titles are user input; a regex-based implementation would corrupt these.
    expect(stripAnnouncementTitle('a.b(c)\n\nbody', 'a.b(c)')).toBe('body');
    expect(stripAnnouncementTitle('$1\n\nbody', '$1')).toBe('body');
  });

  it('does not strip a prefix when the title itself is only whitespace-prefixed differently', () => {
    expect(stripAnnouncementTitle('Title\n\nbody', 'Title ')).toBe('Title\n\nbody');
  });
});

describe('adminUserUpdateSchema', () => {
  /**
   * The admin console's "Email verified" control used to send `isVerified`,
   * which is the cosmetic platform badge — so the account stayed unable to sign
   * in while the UI reported success.
   */
  it('accepts an email verification timestamp', () => {
    const parsed = adminUserUpdateSchema.safeParse({ emailVerifiedAt: '2026-10-04T12:00:00.000Z' });
    expect(parsed.success).toBe(true);
  });

  it('accepts null, which clears verification', () => {
    const parsed = adminUserUpdateSchema.safeParse({ emailVerifiedAt: null });
    expect(parsed.success).toBe(true);
  });

  it('rejects a non-ISO string', () => {
    expect(adminUserUpdateSchema.safeParse({ emailVerifiedAt: 'yesterday' }).success).toBe(false);
  });

  it('still accepts the other account fields', () => {
    expect(adminUserUpdateSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(adminUserUpdateSchema.safeParse({ isVerified: true }).success).toBe(true);
    expect(adminUserUpdateSchema.safeParse({ platformRole: 'ADMIN' }).success).toBe(true);
  });

  it('rejects an empty patch', () => {
    expect(adminUserUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe('Avatar fallbackIcon', () => {
  /**
   * `fallbackIcon` was declared in AvatarProps and passed by fifteen call sites
   * (company avatars in the directory, managers, search, branding), but the
   * component never read it — so a company with no logo showed the initials of
   * its name, and the prop leaked through `...rest` onto the <img> as an invalid
   * DOM attribute.
   */
  it('renders the icon instead of initials when asked', () => {
    const markup = renderToStaticMarkup(<Avatar name="Acme Corp" fallbackIcon="building" />);
    expect(markup).toContain('<svg');
    expect(markup).not.toContain('AC');
  });

  it('falls back to initials when no icon is given', () => {
    const markup = renderToStaticMarkup(<Avatar name="Acme Corp" />);
    expect(markup).toContain('AC');
    expect(markup).not.toContain('<svg');
  });

  it('never forwards fallbackIcon to the <img> element', () => {
    const markup = renderToStaticMarkup(<Avatar src="/logo.png" name="Acme Corp" fallbackIcon="building" />);
    expect(markup).toContain('src="/logo.png"');
    expect(markup.toLowerCase()).not.toContain('fallbackicon');
  });

  it('keeps the accessible name on the fallback', () => {
    const markup = renderToStaticMarkup(<Avatar name="Acme Corp" fallbackIcon="building" />);
    expect(markup).toContain('aria-label="Acme Corp"');
  });
});
