/**
 * Settings pure logic: device classification, tab deep-linking, password rules.
 *
 * These three modules were extracted out of `app/(app)/settings/page.tsx`
 * precisely so the Security/Notifications fixes could be asserted instead of
 * eyeballed — no browser automation is available, so the rules live here as
 * pure functions and the tests pin the behaviour that the UI depends on:
 *
 *  - `describeDevice`  — order-dependent UA branches; a wrong branch shows the
 *                        wrong glyph for a desktop, or calls an iPad a phone.
 *  - `resolveSettingsTab` — the `?tab=` contract that notification deep links
 *                        (`/settings?tab=security`) rely on.
 *  - `passwordFieldErrors` / `passwordStrength` — the client gate must mirror
 *                        the server's `passwordSchema` (min 8), never stricter.
 */
import { describe, expect, it } from 'vitest';
import { describeDevice } from '@/lib/device';
import {
  DEFAULT_SETTINGS_TAB,
  isSettingsTab,
  resolveSettingsTab,
  settingsTabQuery,
} from '@/lib/settings-tabs';
import {
  MIN_PASSWORD_LENGTH,
  passwordFieldErrors,
  passwordStrength,
} from '@/lib/password-strength';

describe('describeDevice', () => {
  it('reports an unknown device for a missing User-Agent', () => {
    expect(describeDevice(null)).toEqual({ label: 'Unknown device', kind: 'desktop' });
    expect(describeDevice('')).toEqual({ label: 'Unknown device', kind: 'desktop' });
  });

  it('classifies a desktop Chrome on Windows', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    expect(describeDevice(ua)).toEqual({ label: 'Chrome on Windows', kind: 'desktop' });
  });

  it('checks Edge before the Chrome substring it also contains', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
    expect(describeDevice(ua).label).toBe('Edge on Windows');
  });

  it('detects Opera from the OPR token', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 OPR/105.0.0.0';
    expect(describeDevice(ua).label).toBe('Opera on Windows');
  });

  it('detects Firefox (no Chrome/Safari tokens)', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0';
    expect(describeDevice(ua)).toEqual({ label: 'Firefox on Windows', kind: 'desktop' });
  });

  it('only calls it Safari when the Version token is present', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
    expect(describeDevice(ua)).toEqual({ label: 'Safari on macOS', kind: 'desktop' });
  });

  it('treats an iPhone as a phone on iOS', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(describeDevice(ua)).toEqual({ label: 'Safari on iOS', kind: 'phone' });
  });

  it('treats an iPad as a tablet on iOS, not a phone on macOS', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    // The "like Mac OS X" token must not win over the iOS branch.
    expect(describeDevice(ua)).toEqual({ label: 'Safari on iOS', kind: 'tablet' });
  });

  it('distinguishes an Android tablet from an Android phone', () => {
    const tablet =
      'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const phone =
      'Mozilla/5.0 (Linux; Android 13; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
    expect(describeDevice(tablet).kind).toBe('tablet');
    expect(describeDevice(phone).kind).toBe('phone');
    expect(describeDevice(phone).label).toBe('Chrome on Android');
  });

  it('handles a curl UA gracefully (no browser, no known OS)', () => {
    expect(describeDevice('curl/8.21.0')).toEqual({ label: 'Unknown OS', kind: 'desktop' });
  });
});

describe('settings tab deep links', () => {
  it('exposes exactly the five tabs the page renders', () => {
    expect(DEFAULT_SETTINGS_TAB).toBe('profile');
    expect(isSettingsTab('security')).toBe(true);
    expect(isSettingsTab('notifications')).toBe(true);
    expect(isSettingsTab('nope')).toBe(false);
    expect(isSettingsTab(null)).toBe(false);
  });

  it('reads ?tab= with or without the leading question mark', () => {
    expect(resolveSettingsTab('?tab=security')).toBe('security');
    expect(resolveSettingsTab('tab=security')).toBe('security');
    expect(resolveSettingsTab('?foo=1&tab=notifications')).toBe('notifications');
  });

  it('falls back to the default for missing or unknown values', () => {
    expect(resolveSettingsTab('')).toBe('profile');
    expect(resolveSettingsTab('?')).toBe('profile');
    expect(resolveSettingsTab('?tab=')).toBe('profile');
    expect(resolveSettingsTab('?tab=bogus')).toBe('profile');
  });

  it('round-trips through settingsTabQuery, keeping the default URL clean', () => {
    expect(settingsTabQuery('profile')).toBe('');
    expect(settingsTabQuery('security')).toBe('tab=security');
    expect(resolveSettingsTab(`?${settingsTabQuery('security')}`)).toBe('security');
    expect(resolveSettingsTab(`?${settingsTabQuery('profile')}`)).toBe('profile');
  });
});

describe('password rules', () => {
  it('mirrors the server minimum of 8 characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  it('flags an empty new-password field as missing, not too short', () => {
    const { next } = passwordFieldErrors('', '');
    expect(next).toBe('Choose a new password.');
  });

  it('rejects a password shorter than the minimum with the exact count', () => {
    const { next } = passwordFieldErrors('short', 'short');
    expect(next).toBe(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  });

  it('accepts a password at exactly the minimum length', () => {
    expect(passwordFieldErrors('12345678', '12345678').next).toBeNull();
  });

  it('asks for the confirm field before complaining about a mismatch', () => {
    expect(passwordFieldErrors('longenough1', '').confirm).toBe('Re-enter the new password.');
  });

  it('reports a mismatch when the two fields differ', () => {
    expect(passwordFieldErrors('longenough1', 'different').confirm).toBe("Passwords don't match.");
  });

  it('clears both fields when they match and satisfy the minimum', () => {
    expect(passwordFieldErrors('longenough1', 'longenough1')).toEqual({
      next: null,
      confirm: null,
    });
  });
});

describe('passwordStrength', () => {
  it('scores an empty password as nothing at all', () => {
    expect(passwordStrength('')).toEqual({ score: 0, label: '' });
  });

  it('calls a short password Weak', () => {
    expect(passwordStrength('abc').label).toBe('Weak');
  });

  it('scores a long-but-simple password Weak (length alone is not enough)', () => {
    // 8 chars, all lowercase → only the length point.
    expect(passwordStrength('aaaaaaaa')).toEqual({ score: 1, label: 'Weak' });
  });

  it('rates lowercase+digit as Fair', () => {
    expect(passwordStrength('abcdefgh1')).toEqual({ score: 2, label: 'Fair' });
  });

  it('rates mixed case + digit as Good', () => {
    expect(passwordStrength('Abcdefgh1')).toEqual({ score: 3, label: 'Good' });
  });

  it('rates 12+ chars with mixed case, digit and symbol as Strong', () => {
    expect(passwordStrength('Abcdefgh1234!')).toEqual({ score: 4, label: 'Strong' });
  });
});
