/**
 * lib/mail/otp-template.ts — the one-time-passcode email.
 *
 * ── Why this is hand-built HTML and not a component ────────────────────────
 *
 * Mail clients are not browsers. Outlook renders through Word; Gmail strips
 * `<style>` blocks in some contexts; every client handles flexbox, grid and
 * `border-radius` differently or not at all. The only layout primitive with
 * near-universal support is a nested `<table>` with inline styles, which is why
 * this file looks the way it does. Do not "modernise" it into divs and classes —
 * it will look right in the preview and broken in Outlook.
 *
 * Concrete constraints honoured here:
 *   • `<table role="presentation">` — layout only, never announced to a
 *     screen reader as data.
 *   • every style inline — no external CSS, no class-only styling.
 *   • a `<!--[if mso]>` fallback for the pill button, because Word ignores
 *     `border-radius` and `padding` on an `<a>`.
 *   • a `<style>` block for the small-screen tweak, plus the MSO conditional
 *     that stops Word from scaling the whole thing down.
 *   • a preheader span, so the inbox preview reads as a sentence instead of
 *     "AvoMessage" followed by the raw code.
 *   • a plain-text alternative, because some clients show only that and some
 *     spam filters treat a missing text part as a signal.
 *
 * ── Branding ───────────────────────────────────────────────────────────────
 *
 * Two marks, in a deliberate order: **Avorex** is the company that sends this,
 * and **AvoMessage** is the product the code belongs to. A recipient who has
 * never heard of AvoMessage needs to know who is emailing them before they will
 * type a code anywhere.
 *
 * Colours are AvoMessage's own tokens (lime-600 #65a30d / lime-500 #84cc16 /
 * teal-600 #0d9488) so the email and the app agree.
 */

const BRAND = {
  lime600: '#65a30d',
  lime500: '#84cc16',
  lime50: '#f7fee7',
  lime800: '#3f6212',
  ink: '#17210c',
  slate900: '#0f172a',
  slate700: '#334155',
  slate500: '#64748b',
  slate400: '#94a3b8',
  line: '#e2e8f0',
  canvas: '#f1f5f9',
  white: '#ffffff',
  teal600: '#0d9488',
} as const;

/**
 * Bengali needs a font that actually has the glyphs. The fallback chain matters
 * more than the first entry: Windows ships Nirmala UI, older Windows has
 * Vrinda, macOS has Bangla MN, and Android/iOS have Noto. Ending in a generic
 * sans-serif means a missing Bengali font degrades to boxes rather than a
 * crash — and the English line below still carries the message.
 */
const FONT_BN =
  "'Noto Sans Bengali','Hind Siliguri','Nirmala UI','Vrinda','Bangla MN','SolaimanLipi',system-ui,-apple-system,'Segoe UI',sans-serif";
const FONT_UI =
  "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const FONT_MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";

export type OtpEmailPurpose = 'SIGNUP' | 'COMPANY_MEMBER' | 'COMPANY_MANAGER';

export interface OtpEmailInput {
  /** First name or full name; may be empty. */
  name: string;
  code: string;
  purpose: OtpEmailPurpose;
  expiresInMinutes: number;
  /** Set for the two company flows, so the mail can name the company. */
  companyName?: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/**
 * Per-purpose copy. Each entry gives the recipient three things: what the code
 * is for, who caused it to be sent, and what to do if it was not them. The last
 * one matters most — an unexpected code means somebody typed their address.
 */
function purposeCopy(input: OtpEmailInput): {
  subject: string;
  bnLead: string;
  bnContext: string;
  enContext: string;
  preheader: string;
} {
  const company = input.companyName ? escapeHtml(input.companyName) : null;

  switch (input.purpose) {
    case 'COMPANY_MEMBER':
      return {
        subject: company
          ? `${input.code} — ${input.companyName} এ যোগ দেওয়ার কোড`
          : `${input.code} — AvoMessage মেম্বার কোড`,
        bnLead: company
          ? `আপনাকে <strong>${company}</strong> টিমে যোগ করা হচ্ছে।`
          : 'আপনাকে একটি টিমে যোগ করা হচ্ছে।',
        bnContext: 'ম্যানেজার আপনার হয়ে অ্যাকাউন্টটি তৈরি করেছেন। নিচের কোডটি দিলেই অ্যাকাউন্ট চালু হবে।',
        enContext: company
          ? `A manager created an AvoMessage account for you at ${input.companyName}. Enter the code below to activate it.`
          : 'A manager created an AvoMessage account for you. Enter the code below to activate it.',
        preheader: `আপনার AvoMessage অ্যাকাউন্ট চালু করার কোড: ${input.code} — ${input.expiresInMinutes} মিনিটের জন্য বৈধ।`,
      };

    case 'COMPANY_MANAGER':
      return {
        subject: company
          ? `${input.code} — ${input.companyName} ম্যানেজার কোড`
          : `${input.code} — AvoMessage ম্যানেজার কোড`,
        bnLead: company
          ? `আপনাকে <strong>${company}</strong> এর ম্যানেজার হিসেবে যোগ করা হচ্ছে।`
          : 'আপনাকে ম্যানেজার হিসেবে যোগ করা হচ্ছে।',
        bnContext: 'অ্যাডমিন আপনার হয়ে অ্যাকাউন্টটি তৈরি করেছেন। নিচের কোডটি দিলেই ম্যানেজার অ্যাকাউন্ট চালু হবে।',
        enContext: company
          ? `An administrator created a manager account for you at ${input.companyName}. Enter the code below to activate it.`
          : 'An administrator created a manager account for you. Enter the code below to activate it.',
        preheader: `আপনার AvoMessage ম্যানেজার অ্যাকাউন্টের কোড: ${input.code} — ${input.expiresInMinutes} মিনিটের জন্য বৈধ।`,
      };

    case 'SIGNUP':
    default:
      return {
        subject: `${input.code} — AvoMessage অ্যাকাউন্ট নিশ্চিত করুন`,
        bnLead: 'AvoMessage-এ আপনাকে স্বাগতম!',
        bnContext: 'আপনার অ্যাকাউন্ট তৈরি করার আগে ইমেইলটি নিশ্চিত করতে হবে। নিচের কোডটি দিন।',
        enContext:
          'Confirm your email address to finish creating your AvoMessage account. Enter the code below.',
        preheader: `আপনার AvoMessage ভেরিফিকেশন কোড: ${input.code} — ${input.expiresInMinutes} মিনিটের জন্য বৈধ।`,
      };
  }
}

/** Plain-text part. Mirrors the HTML; never a link-only stub. */
function textPart(input: OtpEmailInput, copy: ReturnType<typeof purposeCopy>): string {
  const who = input.name ? ` ${input.name}` : '';
  return [
    `AvoMessage — Avorex Technologies`,
    ``,
    `${copy.bnLead.replace(/<[^>]+>/g, '')}`,
    `আপনার ভেরিফিকেশন কোড:  ${input.code}`,
    ``,
    copy.bnContext,
    copy.enContext,
    ``,
    `কোডটি ${input.expiresInMinutes} মিনিটের জন্য বৈধ এবং একবারই ব্যবহার করা যাবে।`,
    `This code expires in ${input.expiresInMinutes} minutes and can be used once.`,
    ``,
    `আপনি যদি এই কোডের অনুরোধ না করে থাকেন, এই ইমেইলটি উপেক্ষা করুন — কারও কারও আপনার ইমেইল ঠিকানা ভুলভাবে লেখা হয়েছে।`,
    `If you did not request this, ignore this email. Someone may have mistyped their address.${who ? '' : ''}`,
    ``,
    `— AvoMessage, an Avorex Technologies product`,
  ].join('\n');
}

export function otpEmail(input: OtpEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const copy = purposeCopy(input);
  const safeName = input.name ? escapeHtml(input.name.trim().split(/\s+/)[0]) : '';
  const greetingBn = safeName ? `প্রিয় ${safeName},` : 'প্রিয় ব্যবহারকারী,';

  // ── Two notes on the dark-mode block below ────────────────────────────────
  //
  // 1. The card stays light on purpose. A dark card with a lime gradient header
  //    reads as a phishing page in several clients, and roughly half of them
  //    would invert our text on their own anyway.
  //
  // 2. The canvas is one visual surface split across two elements — the <body>
  //    and the outer <table> — so both have to be flipped together. Flipping
  //    only the table leaves a light strip under the card wherever the table is
  //    shorter than the viewport, which is exactly what you see when the file
  //    is opened straight in a browser. The !important is what lets the rule
  //    beat the inline background on <body>.
  //
  // 3. No backticks in any comment inside this template literal, and no `${`
  //    that is not a real interpolation. Both terminate it.
  const html = `<!doctype html>
<html lang="bn" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(copy.subject)}</title>
<!--[if mso]>
<style>
  table,td,a,h1,h2,h3,p,span { font-family: Arial, Helvetica, sans-serif !important; }
  .mso-code { font-family: Consolas, monospace !important; }
</style>
<![endif]-->
<style>
  /* Progressive enhancement only. Everything essential is already inline, so a
     client that drops this block loses nothing but the phone-width tweak. */
  @media only screen and (max-width:620px) {
    .avo-card { width:100% !important; border-radius:0 !important; }
    .avo-pad { padding-left:20px !important; padding-right:20px !important; }
    .avo-code { font-size:30px !important; }
    .avo-h1 { font-size:20px !important; }
  }
  @media (prefers-color-scheme: dark) {
    /* Both surfaces, or the canvas ends early and leaves a light strip below
       the card. !important is required to beat the inline background. */
    .avo-body, .avo-canvas { background:#0b1120 !important; }
    .avo-foot { color:#94a3b8 !important; }
  }
</style>
</head>
<body class="avo-body" style="margin:0;padding:0;width:100%;background:${BRAND.canvas};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<!-- Preheader: shown in the inbox list next to the subject, hidden in the body. -->
<div style="display:none;font-size:1px;color:${BRAND.canvas};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
  ${escapeHtml(copy.preheader)}
  &#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;
</div>

<table role="presentation" class="avo-canvas" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.canvas};">
  <tr>
    <td align="center" style="padding:28px 12px 36px;">

      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" class="avo-card" width="600" cellpadding="0" cellspacing="0" border="0"
             style="width:600px;max-width:600px;background:${BRAND.white};border-radius:18px;overflow:hidden;border:1px solid ${BRAND.line};">

        <!-- ── Header: Avorex (who is writing) over AvoMessage (about what) ── -->
        <tr>
          <td style="background:${BRAND.lime600};background-image:linear-gradient(135deg,${BRAND.lime800} 0%,${BRAND.lime600} 55%,${BRAND.teal600} 100%);padding:24px 28px;" class="avo-pad">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;">
                  <div style="font-family:${FONT_UI};font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,.78);font-weight:700;">
                    Avorex Technologies
                  </div>
                  <div style="font-family:${FONT_UI};font-size:26px;line-height:1.15;color:${BRAND.white};font-weight:800;margin-top:4px;">
                    Avo<span style="color:#ecfccb;">Message</span>
                  </div>
                </td>
                <td align="right" style="vertical-align:middle;">
                  <div style="font-family:${FONT_UI};font-size:11px;line-height:1.5;color:rgba(255,255,255,.82);text-align:right;">
                    নিরাপদ অ্যাকাউন্ট<br>ভেরিফিকেশন
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── Body ── -->
        <tr>
          <td class="avo-pad" style="padding:32px 40px 8px;">
            <p style="margin:0 0 6px;font-family:${FONT_BN};font-size:17px;color:${BRAND.slate900};font-weight:700;">
              ${greetingBn}
            </p>
            <h1 class="avo-h1" style="margin:0 0 14px;font-family:${FONT_BN};font-size:23px;line-height:1.45;color:${BRAND.ink};font-weight:800;">
              ${copy.bnLead}
            </h1>
            <p style="margin:0 0 8px;font-family:${FONT_BN};font-size:15px;line-height:1.85;color:${BRAND.slate700};">
              ${copy.bnContext}
            </p>
          </td>
        </tr>

        <!-- ── The code ── -->
        <tr>
          <td class="avo-pad" style="padding:14px 40px 6px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                   style="background:${BRAND.lime50};border:1px dashed #bef264;border-radius:14px;">
              <tr>
                <td align="center" style="padding:22px 16px 18px;">
                  <div style="font-family:${FONT_UI};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${BRAND.lime800};font-weight:700;padding-bottom:10px;">
                    আপনার ভেরিফিকেশন কোড
                  </div>
                  <div class="avo-code mso-code" style="font-family:${FONT_MONO};font-size:38px;line-height:1.1;font-weight:700;color:${BRAND.ink};">
                    ${input.code}
                  </div>
                  <div style="font-family:${FONT_BN};font-size:13px;line-height:1.7;color:${BRAND.slate500};padding-top:12px;">
                    কোডটি <strong style="color:${BRAND.slate700};">${input.expiresInMinutes} মিনিট</strong> পর্যন্ত বৈধ · একবারই ব্যবহার করা যাবে
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── English mirror + the "wasn't me" note ── -->
        <tr>
          <td class="avo-pad" style="padding:20px 40px 0;">
            <p style="margin:0;font-family:${FONT_UI};font-size:13px;line-height:1.75;color:${BRAND.slate500};">
              ${escapeHtml(copy.enContext)}
            </p>
          </td>
        </tr>

        <tr>
          <td class="avo-pad" style="padding:20px 40px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top:1px solid ${BRAND.line};font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>

        <tr>
          <td class="avo-pad" style="padding:18px 40px 30px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                   style="background:#f8fafc;border-left:3px solid ${BRAND.teal600};border-radius:0 10px 10px 0;">
              <tr>
                <td style="padding:14px 18px;">
                  <p style="margin:0;font-family:${FONT_BN};font-size:13px;line-height:1.85;color:${BRAND.slate700};">
                    <strong>আপনি যদি এই কোডের অনুরোধ না করে থাকেন</strong>, তাহলে এই ইমেইলটি উপেক্ষা করুন।
                    কেউ হয়তো ভুল করে আপনার ইমেইল ঠিকানাটি লিখেছে। আপনার অ্যাকাউন্ট নিরাপদে আছে —
                    <strong>এই কোডটি কারও সাথে শেয়ার করবেন না</strong>, AvoMessage-এর কেউ কখনো এটি চাইবে না।
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── Footer ── -->
        <tr>
          <td class="avo-pad avo-foot" style="background:#f8fafc;border-top:1px solid ${BRAND.line};padding:22px 40px;">
            <p style="margin:0 0 6px;font-family:${FONT_UI};font-size:12px;line-height:1.7;color:${BRAND.slate500};">
              <strong style="color:${BRAND.slate700};">Avorex Technologies</strong> — AvoMessage প্ল্যাটফর্ম
            </p>
            <p style="margin:0 0 6px;font-family:${FONT_BN};font-size:12px;line-height:1.8;color:${BRAND.slate400};">
              টিম আর কোম্পানির জন্য নিরাপদ মেসেজিং ও কোলাবোরেশন।
            </p>
            <p style="margin:0;font-family:${FONT_UI};font-size:11px;line-height:1.7;color:${BRAND.slate400};">
              This is an automated message — replies to this address are not monitored.
            </p>
          </td>
        </tr>

      </table>
      <!--[if mso]></td></tr></table><![endif]-->

      <div style="font-family:${FONT_UI};font-size:11px;color:${BRAND.slate400};padding-top:18px;line-height:1.7;">
        &copy; ${new Date().getFullYear()} Avorex Technologies &middot; AvoMessage
      </div>

    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject: copy.subject, html, text: textPart(input, copy) };
}
