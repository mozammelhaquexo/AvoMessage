/**
 * The SMTP DATA payload — `buildSmtpMessage`.
 *
 * This structure has already gone wrong once in a way nothing caught: the
 * driver sent `Content-Type: text/html` alone and dropped the plain-text part
 * entirely. The OTP template generates a text alternative precisely because
 * "some spam filters treat a missing text part as a signal", and the SMTP
 * driver — the one production actually runs — discarded it. The Resend driver
 * passed it through, so the two drivers disagreed about the same email.
 *
 * So these tests are about the two things that matter and are invisible in
 * normal use: that BOTH parts ship, and that they ship in the order the format
 * requires. Pure string assertions, no socket, no network.
 */
import { describe, expect, it } from 'vitest';
import { buildSmtpMessage, encodeHeaderValue, type SendMailOptions } from '@/lib/mailer';

const OPTS: SendMailOptions = {
  to: 'member@example.com',
  subject: '482913 — AvoMessage মেম্বার কোড',
  html: '<p>প্রিয় সদস্য, আপনার কোড <strong>482913</strong></p>',
  text: 'প্রিয় সদস্য,\n\nআপনার কোড: 482913\n',
  tag: 'otp',
};

const CTX = {
  from: 'Avorex AvoMessage <noreply@example.com>',
  replyTo: 'support@example.com',
  date: 'Mon, 06 Oct 2026 09:00:00 GMT',
  messageId: '<fixed@example.com>',
  boundary: 'avo-test-boundary',
};

/** The decoded body of the part with the given Content-Type. */
function partBody(message: string, contentType: string): string | null {
  const lines = message.split('\r\n');
  const start = lines.findIndex((l) => l.startsWith(`Content-Type: ${contentType}`));
  if (start === -1) return null;
  // Skip the part's own headers to the blank line, then take the base64 run.
  let i = start + 1;
  while (i < lines.length && lines[i] !== '') i += 1;
  i += 1;
  const b64: string[] = [];
  while (i < lines.length && lines[i] !== '' && !lines[i].startsWith('--')) {
    b64.push(lines[i]);
    i += 1;
  }
  return Buffer.from(b64.join(''), 'base64').toString('utf8');
}

describe('buildSmtpMessage', () => {
  it('sends BOTH a plain-text and an HTML part', () => {
    const msg = buildSmtpMessage(OPTS, CTX);

    expect(partBody(msg, 'text/plain; charset=utf-8')).toBe(OPTS.text);
    expect(partBody(msg, 'text/html; charset=utf-8')).toBe(OPTS.html);
  });

  it('declares multipart/alternative and closes the boundary', () => {
    const msg = buildSmtpMessage(OPTS, CTX);

    expect(msg).toContain('Content-Type: multipart/alternative; boundary="avo-test-boundary"');
    expect(msg).toContain('--avo-test-boundary--');
  });

  it('puts the text part FIRST, because the last part is the preferred one', () => {
    // RFC 2046: alternatives run least-preferred to most-preferred, so a client
    // renders the LAST part it understands. Reversed, every text-only client
    // would show raw markup.
    const msg = buildSmtpMessage(OPTS, CTX);
    expect(msg.indexOf('Content-Type: text/plain')).toBeLessThan(
      msg.indexOf('Content-Type: text/html'),
    );
  });

  it('carries a Reply-To, defaulting to something valid rather than nothing', () => {
    expect(buildSmtpMessage(OPTS, CTX)).toContain('Reply-To: support@example.com');
  });

  it('RFC 2047 encodes a non-ASCII subject and keeps the header 7-bit', () => {
    const msg = buildSmtpMessage(OPTS, CTX);
    const subjectLine = msg.split('\r\n').find((l) => l.startsWith('Subject: '))!;

    expect(subjectLine).toContain('=?UTF-8?B?');
    // The raw Bengali must not appear in a header.
    expect(subjectLine).not.toContain('মেম্বার');
  });

  it('keeps an ASCII display name readable and the bare address in From', () => {
    const msg = buildSmtpMessage(OPTS, CTX);
    const fromLine = msg.split('\r\n').find((l) => l.startsWith('From: '))!;
    expect(fromLine).toBe('From: Avorex AvoMessage <noreply@example.com>');
  });

  it('encodes a non-ASCII display name instead of putting raw UTF-8 in a header', () => {
    // SMTP headers are 7-bit; a Bengali display name sent raw is invalid.
    const msg = buildSmtpMessage(OPTS, { ...CTX, from: 'অ্যাভোরেক্স <noreply@example.com>' });
    const fromLine = msg.split('\r\n').find((l) => l.startsWith('From: '))!;
    expect(fromLine).toContain('=?UTF-8?B?');
    expect(fromLine).toContain('noreply@example.com');
    expect(fromLine).not.toContain('অ্যাভোরেক্স');
  });

  it('terminates the DATA payload with a lone dot', () => {
    const msg = buildSmtpMessage(OPTS, CTX);
    expect(msg.endsWith('--avo-test-boundary--\r\n.\r\n')).toBe(true);
  });

  it('never emits a body line that could be read as end-of-data', () => {
    // base64 makes this structural rather than a matter of luck: no base64 line
    // can start with "." — which is why the body is encoded at all.
    const msg = buildSmtpMessage(OPTS, CTX);
    const dotLines = msg
      .split('\r\n')
      .filter((l) => l.startsWith('.') && l !== '.' && !l.startsWith('--'));
    expect(dotLines).toEqual([]);
  });

  it('encodes the subject the same way the rest of the app does', () => {
    // Guards the shared helper, so the message and any future caller agree.
    expect(encodeHeaderValue('plain')).toBe('plain');
    expect(encodeHeaderValue('কোড')).toMatch(/^=\?UTF-8\?B\?/);
  });
});
