/**
 * The OTP email template.
 *
 * `lib/mail/otp-template.ts` is the most user-visible thing in this feature and
 * was, until now, the least covered: the live runs prove it *sends*, and the
 * flow tests prove a code round-trips, but nothing pinned what the recipient
 * actually receives.
 *
 * What is asserted here is the part that breaks silently:
 *
 *   • the subject carries the code, because that is what the recipient reads in
 *     the inbox list before opening anything;
 *   • the code and the expiry appear in BOTH parts — a client that shows only
 *     the text part must still be usable;
 *   • user-supplied strings are escaped, so a company named with a `<` cannot
 *     inject markup into a mail we send under our own brand;
 *   • the dark-mode canvas is flipped on both surfaces at once. That one is a
 *     regression test with a real story: the canvas is a `<body>` and an outer
 *     `<table>`, and flipping only the table left a light strip under the card
 *     in every client that sized the message shorter than its viewport.
 *
 * Layout — whether the header gradient renders, whether the Bengali has a font —
 * is not testable from a string, and is covered by `scripts/render-otp-email.ts`
 * plus a screenshot.
 */
import { describe, expect, it } from 'vitest';
import { otpEmail, type OtpEmailInput } from '@/lib/mail/otp-template';

const signup: OtpEmailInput = {
  name: 'Ada Lovelace',
  code: '418902',
  purpose: 'SIGNUP',
  expiresInMinutes: 10,
};

const member: OtpEmailInput = {
  name: 'Nusrat Jahan',
  code: '573104',
  purpose: 'COMPANY_MEMBER',
  expiresInMinutes: 10,
  companyName: 'Avocado Labs',
};

const manager: OtpEmailInput = {
  name: 'Tanvir Ahmed',
  code: '908233',
  purpose: 'COMPANY_MANAGER',
  expiresInMinutes: 10,
  companyName: 'Avocado Labs',
};

/** The inner text of the element the code is rendered in. */
function codeInner(html: string): string {
  return /<div class="avo-code[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1]?.trim() ?? '';
}

/** The inline style on that element. */
function codeStyle(html: string): string {
  return /<div class="avo-code[^"]*" style="([^"]*)"/.exec(html)?.[1] ?? '';
}

describe('otpEmail — subject', () => {
  it('leads with the code, so it is readable from the inbox list', () => {
    for (const input of [signup, member, manager]) {
      expect(otpEmail(input).subject.startsWith(input.code)).toBe(true);
    }
  });

  it('names the company for the two company flows', () => {
    expect(otpEmail(member).subject).toBe('573104 — Avocado Labs এ যোগ দেওয়ার কোড');
    expect(otpEmail(manager).subject).toBe('908233 — Avocado Labs ম্যানেজার কোড');
  });

  it('falls back to a generic subject when the company is unknown', () => {
    expect(otpEmail({ ...member, companyName: null }).subject).toBe('573104 — AvoMessage মেম্বার কোড');
    expect(otpEmail({ ...manager, companyName: undefined }).subject).toBe(
      '908233 — AvoMessage ম্যানেজার কোড',
    );
  });

  it('says what the signup code is for', () => {
    expect(otpEmail(signup).subject).toBe('418902 — AvoMessage অ্যাকাউন্ট নিশ্চিত করুন');
  });
});

describe('otpEmail — the code reaches both parts', () => {
  it('renders the digits as one unbroken token', () => {
    const { html } = otpEmail(signup);
    // Exactly the six digits and nothing else, so the code can be selected and
    // copied in one go.
    expect(codeInner(html)).toBe(signup.code);
  });

  it('puts no letter-spacing or padding between the digits', () => {
    const { html } = otpEmail(signup);
    // Both of these were used to spread the digits out; neither may come back.
    expect(codeStyle(html)).not.toContain('letter-spacing');
    expect(codeStyle(html)).not.toContain('padding-left');
    // The phone-width override spread them too.
    const phone = /@media only screen and \(max-width:620px\) \{([\s\S]*?)\n  \}/.exec(html)?.[1] ?? '';
    expect(phone).not.toContain('letter-spacing');
  });

  it('puts the bare code in the text part', () => {
    expect(otpEmail(signup).text).toContain('418902');
  });

  it('states the expiry in both parts', () => {
    const { html, text } = otpEmail({ ...signup, expiresInMinutes: 15 });
    expect(html).toContain('15 মিনিট');
    expect(text).toContain('15 মিনিটের জন্য বৈধ');
    expect(text).toContain('expires in 15 minutes');
  });

  it('leaves no HTML tags in the text part', () => {
    // The Bengali lead contains <strong> in the HTML; the text part strips it.
    expect(otpEmail(member).text).not.toMatch(/<[a-z/][^>]*>/i);
  });
});

describe('otpEmail — both brand marks', () => {
  it('credits Avorex and names AvoMessage', () => {
    const { html, text } = otpEmail(signup);
    expect(html).toContain('Avorex Technologies');
    expect(html).toContain('AvoMessage');
    expect(text).toContain('Avorex Technologies');
  });

  it('carries Bengali copy, not only English', () => {
    const { html } = otpEmail(signup);
    // Bengali block U+0980–U+09FF. Asserting the script rather than a specific
    // sentence, so copy edits do not fail the test but a lost font/locale does.
    expect(/[\u0980-\u09FF]/.test(html)).toBe(true);
  });

  it('greets by first name only', () => {
    expect(otpEmail(signup).html).toContain('প্রিয় Ada,');
    expect(otpEmail(signup).html).not.toContain('Ada Lovelace');
  });

  it('falls back to a generic greeting when no name is given', () => {
    expect(otpEmail({ ...signup, name: '' }).html).toContain('প্রিয় ব্যবহারকারী,');
  });
});

describe('otpEmail — untrusted strings are escaped', () => {
  it('escapes a company name that tries to inject markup', () => {
    const { html, text } = otpEmail({
      ...member,
      companyName: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    // The plain-text part is not markup, so it carries the raw characters —
    // which is correct, and worth pinning so nobody "fixes" it into entities.
    expect(text).toContain('<script>alert(1)</script>');
  });

  it('escapes a name that tries to inject markup', () => {
    const { html } = otpEmail({ ...signup, name: '"><img src=x>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('otpEmail — the document is complete', () => {
  it('emits a full HTML document', () => {
    const { html } = otpEmail(signup);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
  });

  it('carries no unresolved interpolation or undefined', () => {
    const { html, text } = otpEmail(member);
    for (const part of [html, text]) {
      expect(part).not.toContain('${');
      expect(part).not.toContain('undefined');
      expect(part).not.toContain('[object Object]');
    }
  });

  it('is laid out with presentation tables, not divs', () => {
    // Mail clients are not browsers; see the file header for why this matters.
    expect(otpEmail(signup).html).toContain('role="presentation"');
  });
});

describe('otpEmail — the dark-mode canvas', () => {
  /**
   * The canvas is one visual surface split across two elements: `<body>` and the
   * outer `<table class="avo-canvas">`. Flipping only the table left a light
   * strip beneath the card wherever the message was shorter than the viewport,
   * which is exactly what you see when the file is opened in a browser.
   */
  it('marks the body as part of the canvas', () => {
    expect(otpEmail(signup).html).toContain('<body class="avo-body"');
  });

  it('flips both canvas surfaces together in dark mode', () => {
    const { html } = otpEmail(signup);
    const block = /@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n  \}/.exec(html)?.[1];
    expect(block, 'dark-mode block not found').toBeTruthy();
    expect(block).toContain('.avo-body');
    expect(block).toContain('.avo-canvas');
    // The rule has to beat the inline `background` on <body>, so it needs
    // !important — without it the strip comes straight back.
    expect(block).toContain('!important');
  });

  it('keeps the card light in dark mode, on purpose', () => {
    // A dark card under a lime gradient header reads as phishing in several
    // clients. Only the canvas moves.
    const { html } = otpEmail(signup);
    const block = /@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n  \}/.exec(html)?.[1] ?? '';
    expect(block).not.toContain('.avo-card');
  });
});
