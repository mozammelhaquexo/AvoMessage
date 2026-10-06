/**
 * Mailer abstraction (ARCHITECTURE.md §6).
 *
 *   MAILER_DRIVER=log    → dev default: console + ./storage/mail/<ts>-<tag>.html
 *   MAILER_DRIVER=resend → RESEND_API_KEY
 *   MAILER_DRIVER=smtp   → SMTP_HOST/PORT/USER/PASSWORD/FROM (+ SMTP_SECURE)
 *
 * Templates live in this module (lib/mail/templates/* in the arch doc maps to
 * the `Templates` object below). Every template returns { subject, html, text }.
 * Base URL for links comes from APP_URL.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { otpEmail, type OtpEmailPurpose } from '@/lib/mail/otp-template';

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  tag?: string;
}

export interface Mailer {
  send(opts: SendMailOptions): Promise<void>;
}

function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function baseTemplate(title: string, heading: string, bodyHtml: string, cta?: { href: string; label: string }): { html: string } {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;margin:0;padding:32px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,.06);">
<div style="font-size:22px;font-weight:800;margin-bottom:8px;">🥑 AvoMessage</div>
<h1 style="font-size:20px;margin:0 0 16px;">${escapeHtml(heading)}</h1>
<div style="color:#334155;line-height:1.6;">${bodyHtml}</div>
${cta ? `<p style="margin:24px 0;"><a href="${escapeHtml(cta.href)}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;">${escapeHtml(cta.label)}</a></p>` : ''}
<p style="color:#94a3b8;font-size:12px;margin-top:32px;">If you didn't request this, you can safely ignore this email.</p>
</div></body></html>`;
  return { html };
}

// ─── Templates ──────────────────────────────────────────────────────────────

export interface Template {
  subject: string;
  html: string;
  text: string;
}

export const Templates = {
  /**
   * The one-time passcode. Delegates to lib/mail/otp-template.ts — it is a
   * large, deliberately old-fashioned table layout with Bengali copy, and it
   * would swamp this file.
   */
  otpCode(
    name: string,
    code: string,
    purpose: OtpEmailPurpose,
    opts: { companyName?: string | null; expiresInMinutes?: number } = {},
  ): Template {
    return otpEmail({
      name,
      code,
      purpose,
      companyName: opts.companyName ?? null,
      expiresInMinutes: opts.expiresInMinutes ?? 10,
    });
  },

  verifyEmail(name: string, token: string): Template {
    const link = `${appUrl()}/verify-email?token=${token}`;
    const { html } = baseTemplate(
      'Verify your email',
      `Welcome, ${name}!`,
      `<p>Thanks for joining AvoMessage. Please verify your email address to unlock posting, commenting and messaging.</p><p>This link expires in 24 hours.</p>`,
      { href: link, label: 'Verify email' },
    );
    return {
      subject: 'Verify your AvoMessage email',
      html,
      text: `Welcome, ${name}!\n\nVerify your email: ${link}\n\nThis link expires in 24 hours.`,
    };
  },

  resetPassword(name: string, token: string): Template {
    const link = `${appUrl()}/reset-password?token=${token}`;
    const { html } = baseTemplate(
      'Reset your password',
      'Password reset requested',
      `<p>Hi ${escapeHtml(name)},</p><p>We received a request to reset your AvoMessage password. This link expires in 1 hour.</p>`,
      { href: link, label: 'Reset password' },
    );
    return {
      subject: 'Reset your AvoMessage password',
      html,
      text: `Hi ${name},\n\nReset your password: ${link}\n\nThis link expires in 1 hour.`,
    };
  },

  invitation(companyName: string, inviterName: string, token: string): Template {
    const link = `${appUrl()}/invite/${token}`;
    const { html } = baseTemplate(
      'Company invitation',
      `You're invited to ${companyName}`,
      `<p>${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(companyName)}</strong> on AvoMessage.</p><p>This invitation expires in 7 days.</p>`,
      { href: link, label: 'Accept invitation' },
    );
    return {
      subject: `Invitation to join ${companyName} on AvoMessage`,
      html,
      text: `${inviterName} invited you to join ${companyName} on AvoMessage.\n\nAccept: ${link}\n\nExpires in 7 days.`,
    };
  },

  securityAlert(name: string, event: string, ip?: string | null): Template {
    const { html } = baseTemplate(
      'Security alert',
      'Security alert',
      `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(event)}${ip ? ` from IP <code>${escapeHtml(ip)}</code>` : ''}.</p><p>If this wasn't you, reset your password immediately and review your active sessions.</p>`,
    );
    return {
      subject: 'AvoMessage security alert',
      html,
      text: `Hi ${name},\n\n${event}${ip ? ` from IP ${ip}` : ''}.\n\nIf this wasn't you, reset your password immediately.`,
    };
  },
};

// ─── Drivers ────────────────────────────────────────────────────────────────

function mailDir(): string {
  return process.env.MAILER_LOG_DIR ?? join(process.cwd(), 'storage', 'mail');
}

/**
 * RFC 2047 encode a header value that contains anything outside printable
 * ASCII. SMTP headers are 7-bit; a raw Bengali subject line is not valid and
 * gets mangled or dropped by the receiving MTA — the OTP emails are Bengali on
 * purpose, so this is load-bearing, not a nicety.
 */
export function encodeHeaderValue(value: string): string {
  if (!/[^\x20-\x7E]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/**
 * Split a `Display Name <addr@host>` into an RFC 2047-encoded display name and
 * the bare address. Non-ASCII display names hit exactly the same 7-bit limit.
 */
export function encodeFromHeader(from: string): string {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (!m) return encodeHeaderValue(from.trim());
  const [, name, addr] = m;
  if (!name) return `<${addr}>`;
  return `${encodeHeaderValue(name)} <${addr}>`;
}

/**
 * The bare `addr@host` from a possibly-decorated From value.
 *
 * This is what the SMTP ENVELOPE needs (`MAIL FROM:<addr>`), and it is not the
 * same thing as the `From:` header. Passing the whole
 * `"Name <addr>"` string into the envelope produces a malformed command and
 * Gmail answers `555 5.5.2 specifications` — which reads like a syntax error
 * somewhere else entirely. It stays hidden until someone puts a display name in
 * SMTP_FROM, which is exactly what a branded sender address does.
 */
export function bareAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim();
}

/** RFC 2047 base64, wrapped to the 76-char line limit the SMTP spec requires. */
function base64Body(value: string): string {
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  return (b64.match(/.{1,76}/g) ?? [b64]).join('\r\n');
}

/**
 * The DATA payload for the SMTP driver.
 *
 * Pure and exported so the header/part structure can be asserted without
 * opening a socket — which matters, because the structure is the part that
 * keeps going wrong. It previously sent `Content-Type: text/html` alone and
 * dropped `opts.text` entirely, on the one path whose own template
 * documentation warns that "some spam filters treat a missing text part as a
 * signal". Resend got the text part; SMTP silently discarded it.
 *
 * ── Why multipart/alternative, and why the text part is FIRST ─────────────
 *
 * RFC 2046 defines the alternatives as least-preferred to most-preferred, so a
 * client renders the LAST part it can handle. Text first means a text-only
 * client shows the message and an HTML client still gets the designed email;
 * HTML first would make text-only clients display raw markup.
 *
 * Headers must be 7-bit: the subject and the display name are RFC 2047
 * encoded, and both bodies are base64 so Bengali survives intact. Base64 also
 * makes dot-stuffing impossible — a raw line starting with "." would otherwise
 * be read as the end-of-data marker.
 */
export function buildSmtpMessage(
  opts: SendMailOptions,
  ctx: { from: string; replyTo: string; date: string; messageId: string; boundary: string },
): string {
  return [
    `From: ${encodeFromHeader(ctx.from)}`,
    `Reply-To: ${ctx.replyTo}`,
    `To: ${opts.to}`,
    `Subject: ${encodeHeaderValue(opts.subject)}`,
    `Date: ${ctx.date}`,
    `Message-ID: ${ctx.messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${ctx.boundary}"`,
    ``,
    `--${ctx.boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    base64Body(opts.text),
    `--${ctx.boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    base64Body(opts.html),
    `--${ctx.boundary}--`,
    `.`,
    ``,
  ].join('\r\n');
}

/** Dev driver: console + ./storage/mail/<ts>-<tag>.html for inspection. */
export class LogMailer implements Mailer {
  async send(opts: SendMailOptions): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tag = (opts.tag ?? 'mail').replace(/[^a-z0-9-]/gi, '');
    console.log(`[mailer:log] to=${opts.to} subject=${opts.subject} tag=${tag}`);
    try {
      await mkdir(mailDir(), { recursive: true });
      await writeFile(join(mailDir(), `${stamp}-${tag}.html`), opts.html, 'utf8');
    } catch (e) {
      console.warn('[mailer:log] could not write mail file', e);
    }
  }
}

/** Resend driver (prod). */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(opts: SendMailOptions): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        tags: opts.tag ? [{ name: 'tag', value: opts.tag }] : undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend send failed (${res.status}): ${body.slice(0, 500)}`);
    }
  }
}

/**
 * Minimal dependency-free SMTP client (prod alternative to Resend).
 * Supports STARTTLS (port 587) and implicit TLS (port 465) + AUTH LOGIN.
 */
export class SmtpMailer implements Mailer {
  private readonly host: string;
  private readonly port: number;
  private readonly user: string;
  private readonly password: string;
  private readonly from: string;
  private readonly secure: boolean;

  constructor() {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_SECURE } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) {
      throw new Error('SMTP_HOST/SMTP_USER/SMTP_PASSWORD/SMTP_FROM must all be set for the smtp mailer');
    }
    this.host = SMTP_HOST;
    this.port = Number(SMTP_PORT ?? 587);
    this.user = SMTP_USER;
    this.password = SMTP_PASSWORD;
    this.from = SMTP_FROM;
    this.secure = SMTP_SECURE === '1' || this.port === 465;
  }

  async send(opts: SendMailOptions): Promise<void> {
    // `io` is the active transport; replaced by the TLS socket after STARTTLS.
    let io: import('node:net').Socket = this.secure
      ? (tlsConnect({ host: this.host, port: this.port }) as unknown as import('node:net').Socket)
      : createConnection({ host: this.host, port: this.port });

    let buffer = '';
    const waitFor = (code: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const sock = io;
        const onData = (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          let idx: number;
          while ((idx = buffer.indexOf('\r\n')) >= 0) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            if (/^\d{3} /.test(line)) {
              sock.off('data', onData);
              if (line.startsWith(code)) resolve();
              else reject(new Error(`SMTP error: ${line}`));
              return;
            }
          }
        };
        sock.on('data', onData);
        sock.once('error', (err) => {
          sock.off('data', onData);
          reject(err);
        });
      });

    const cmd = async (c: string, expect: string) => {
      io.write(c + '\r\n');
      await waitFor(expect);
    };

    try {
      await waitFor('220');
      await cmd(`EHLO ${this.host}`, '250');
      if (!this.secure) {
        await cmd('STARTTLS', '220');
        const tls = tlsConnect({
          socket: io,
          servername: this.host,
        });
        await new Promise<void>((resolve, reject) => {
          tls.once('secureConnect', () => resolve());
          tls.once('error', reject);
        });
        io = tls as unknown as import('node:net').Socket;
        await cmd(`EHLO ${this.host}`, '250');
      }
      await cmd('AUTH LOGIN', '334');
      await cmd(Buffer.from(this.user).toString('base64'), '334');
      await cmd(Buffer.from(this.password).toString('base64'), '235');
      // Envelope: bare address only. See bareAddress() for why.
      await cmd(`MAIL FROM:<${bareAddress(this.from)}>`, '250');
      await cmd(`RCPT TO:<${opts.to}>`, '250');
      await cmd('DATA', '354');
      const date = new Date().toUTCString();
      const messageId = `<${randomUUID()}@${bareAddress(this.from).split('@')[1] ?? 'avomessage'}>`;
      const boundary = `avo-${randomUUID()}`;
      /*
       * Reply-To is configurable because a no-reply sender with no way back is
       * itself a mild spam signal — receivers like a route for a human. It
       * defaults to the envelope address rather than being omitted, so the
       * header is always present and always valid.
       */
      const replyTo = process.env.SMTP_REPLY_TO?.trim() || bareAddress(this.from);
      io.write(
        buildSmtpMessage(opts, { from: this.from, replyTo, date, messageId, boundary }),
      );
      await waitFor('250');
      await cmd('QUIT', '221');
    } finally {
      io.destroy();
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let mailer: Mailer | null = null;

/** Mailer selected by MAILER_DRIVER env (log | resend | smtp). */
export function getMailer(): Mailer {
  if (mailer) return mailer;
  const driver = (process.env.MAILER_DRIVER ?? 'log').toLowerCase();
  switch (driver) {
    case 'resend': {
      const key = process.env.RESEND_API_KEY;
      if (!key) throw new Error('RESEND_API_KEY is required for the resend mailer');
      mailer = new ResendMailer(key, process.env.SMTP_FROM ?? 'AvoMessage <noreply@example.com>');
      break;
    }
    case 'smtp':
      mailer = new SmtpMailer();
      break;
    case 'log':
    default:
      mailer = new LogMailer();
  }
  return mailer;
}

/** Test hook: replace the singleton mailer. */
export function setMailer(m: Mailer | null): void {
  mailer = m;
}
