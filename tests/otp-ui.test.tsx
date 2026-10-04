/**
 * The OTP UI: the six-box code field and the step-2 panel.
 *
 * Both are presentational enough to render with `react-dom/server` in the
 * default node environment — no jsdom, no testing-library (see
 * tests/user-badges.test.tsx for the same approach). What can be asserted this
 * way is the *contract*: the ARIA wiring, which box offers the platform's
 * one-time-code autofill, that the field refuses to submit until it is
 * complete, and that the copy matches the flow it is being used for. The
 * keystroke behaviour itself (paste-to-fill, arrow navigation, auto-submit) is
 * driven by handlers that need a DOM, and is covered end to end by
 * scripts/verify-otp-flows.ts against the running app.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { OtpInput } from '@/components/ui/otp-input';
import { OtpStep } from '@/components/auth/otp-step';
import { ApiError } from '@/lib/api-client';
import { formatCountdown, otpErrorMessage, OTP_CODE_LENGTH, type OtpChallenge } from '@/lib/otp-client';

const challenge: OtpChallenge = {
  challengeId: 'ckchallenge00000000000000001',
  email: 'ada@example.com',
  expiresAt: '2026-01-01T00:10:00.000Z',
  resendAfterMs: 60_000,
};

function render(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

/*
 * `renderToStaticMarkup` writes React's prop names as given, so the markup says
 * `inputMode`/`autoComplete` where the browser's DOM would say
 * `inputmode`/`autocomplete`. It also escapes apostrophes to `&#x27;`. Both are
 * artifacts of string-rendering rather than of the component, so the assertions
 * below are written against what is actually emitted.
 */
const countNumeric = (html: string) => html.match(/inputmode="numeric"/gi)?.length;
const countAutofill = (html: string) => html.match(/autocomplete="one-time-code"/gi)?.length;
const countOff = (html: string) => html.match(/autocomplete="off"/gi)?.length;

describe('OtpInput', () => {
  it('renders one box per digit, each labelled and numeric', () => {
    const html = render(<OtpInput value="" onChange={() => {}} />);
    for (let i = 1; i <= OTP_CODE_LENGTH; i++) {
      expect(html).toContain(`aria-label="Digit ${i} of ${OTP_CODE_LENGTH}"`);
    }
    // 6 boxes, and nothing that would open a text keyboard on mobile.
    expect(countNumeric(html)).toBe(OTP_CODE_LENGTH);
    expect(html.match(/type="text"/g)?.length).toBe(OTP_CODE_LENGTH);
  });

  it('names the group so a screen reader hears one field, not six', () => {
    const html = render(<OtpInput value="" onChange={() => {}} label="6-digit verification code" />);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="6-digit verification code"');
  });

  it('offers the platform one-time-code autofill on the first box only', () => {
    const html = render(<OtpInput value="" onChange={() => {}} />);
    expect(countAutofill(html)).toBe(1);
    expect(countOff(html)).toBe(OTP_CODE_LENGTH - 1);
  });

  it('distributes the value across the boxes, left-aligned', () => {
    const html = render(<OtpInput value="12" onChange={() => {}} />);
    expect(html).toContain('value="1"');
    expect(html).toContain('value="2"');
    // Four still empty.
    expect(html.match(/value=""/g)?.length).toBe(OTP_CODE_LENGTH - 2);
  });

  it('marks every box invalid together, since the code is one value', () => {
    const html = render(<OtpInput value="123456" onChange={() => {}} invalid />);
    expect(html.match(/aria-invalid="true"/g)?.length).toBe(OTP_CODE_LENGTH);
  });

  it('does not mark anything invalid when the field is fine', () => {
    const html = render(<OtpInput value="123456" onChange={() => {}} />);
    expect(html).not.toContain('aria-invalid');
  });

  it('disables every box when disabled', () => {
    const html = render(<OtpInput value="" onChange={() => {}} disabled />);
    expect(html.match(/disabled=""/g)?.length).toBe(OTP_CODE_LENGTH);
  });

  it('honours a custom length', () => {
    const html = render(<OtpInput value="" onChange={() => {}} length={4} />);
    expect(countNumeric(html)).toBe(4);
    expect(html).toContain('aria-label="Digit 4 of 4"');
  });
});

describe('OtpStep', () => {
  const noop = async () => undefined;

  it('names the address the code went to, for the signup flow', () => {
    const html = render(
      <OtpStep challenge={challenge} purpose="signup" onVerify={noop} onResend={async () => challenge} />,
    );
    expect(html).toContain('Confirm your email address');
    expect(html).toContain('ada@example.com');
    expect(html).toContain('your account is created');
  });

  it('says which company and which role for the member flow', () => {
    const html = render(
      <OtpStep
        challenge={challenge}
        purpose="member"
        companyName="Avocado Labs"
        onVerify={noop}
        onResend={async () => challenge}
      />,
    );
    expect(html).toContain('Confirm the member&#x27;s email');
    expect(html).toContain('Avocado Labs');
    expect(html).toContain('they join Avocado Labs as a Member');
  });

  it('says which company and which role for the manager flow', () => {
    const html = render(
      <OtpStep
        challenge={challenge}
        purpose="manager"
        companyName="Avocado Labs"
        onVerify={noop}
        onResend={async () => challenge}
      />,
    );
    expect(html).toContain('Confirm the manager&#x27;s email');
    expect(html).toContain('They become a manager of Avocado Labs');
  });

  it('will not offer to submit an incomplete code', () => {
    const html = render(
      <OtpStep challenge={challenge} purpose="signup" onVerify={noop} onResend={async () => challenge} />,
    );
    // The primary action is present, says what it will do, and is disabled
    // while the field is empty.
    const label = html.indexOf('Verify and continue');
    expect(label).toBeGreaterThan(-1);
    expect(html.slice(Math.max(0, label - 400), label)).toContain('disabled');
    expect(html).not.toContain('This code has expired');
  });

  it('never renders the code, even when the server sends one', () => {
    // The code belongs in the inbox and nowhere else. A dev-only echo used to
    // be rendered here as a "tap to fill" button; it is gone on purpose, so
    // this asserts the absence rather than the presence.
    const withCode = render(
      <OtpStep
        challenge={{ ...challenge, devCode: '424242' }}
        purpose="signup"
        onVerify={noop}
        onResend={async () => challenge}
      />,
    );
    expect(withCode).not.toContain('424242');
    expect(withCode).not.toContain('Development only');
    expect(withCode).not.toContain('tap to fill');
  });

  it('still renders every purpose when the server sends no code', () => {
    for (const purpose of ['signup', 'member', 'manager'] as const) {
      const html = render(
        <OtpStep challenge={challenge} purpose={purpose} onVerify={noop} onResend={async () => challenge} />,
      );
      expect(html).toContain('Verify and continue');
      expect(html).not.toContain('tap to fill');
    }
  });

  it('holds the resend behind its cooldown, and shows the wait', () => {
    const html = render(
      <OtpStep challenge={challenge} purpose="signup" onVerify={noop} onResend={async () => challenge} />,
    );
    expect(html).toContain('Resend in 1:00');
    expect(html).not.toContain('Send a new code');
  });

  it('offers a way back to step 1 only when the caller provides one', () => {
    const withBack = render(
      <OtpStep
        challenge={challenge}
        purpose="signup"
        onVerify={noop}
        onResend={async () => challenge}
        onBack={() => {}}
        backLabel="Change your details"
      />,
    );
    expect(withBack).toContain('Change your details');

    const withoutBack = render(
      <OtpStep challenge={challenge} purpose="signup" onVerify={noop} onResend={async () => challenge} />,
    );
    expect(withoutBack).not.toContain('Use a different email');
  });
});

describe('formatCountdown', () => {
  it('formats as m:ss and never goes negative', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5000)).toBe('0:00');
    expect(formatCountdown(1000)).toBe('0:01');
    expect(formatCountdown(59_000)).toBe('0:59');
    expect(formatCountdown(60_000)).toBe('1:00');
    expect(formatCountdown(600_000)).toBe('10:00');
  });

  it('rounds up, so the last second is shown rather than skipped', () => {
    expect(formatCountdown(400)).toBe('0:01');
  });
});

describe('otpErrorMessage', () => {
  const api = (code: string, message: string) => new ApiError(code, message, 400);

  it('explains an expired code in its own words', () => {
    expect(otpErrorMessage(api('OTP_EXPIRED', 'raw'))).toMatch(/expired/i);
  });

  it('explains a spent code in its own words', () => {
    expect(otpErrorMessage(api('OTP_USED', 'raw'))).toMatch(/already been used/i);
  });

  it('tells the user to ask for a new code once the attempts are gone', () => {
    expect(otpErrorMessage(api('OTP_ATTEMPTS_EXCEEDED', 'raw'))).toMatch(/Request a new code/);
  });

  it('passes through the attempts-left message, which is genuinely useful', () => {
    const msg = 'That code is not correct. 3 attempts left.';
    expect(otpErrorMessage(api('OTP_INVALID', msg))).toBe(msg);
  });

  it('handles a network failure and a non-ApiError without leaking "undefined"', () => {
    expect(otpErrorMessage(api('NETWORK_ERROR', 'x'))).toMatch(/connection/i);
    expect(otpErrorMessage(new Error('boom'))).toBe('boom');
    expect(otpErrorMessage('a string')).toMatch(/could not be verified/i);
  });
});
