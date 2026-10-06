# OTP email deliverability

Why the signup code lands in Gmail's Spam folder, what was actually wrong, and
what has to change outside this repository.

---

## The state as measured

Production (`vercel env ls production`) runs:

| variable | value |
| --- | --- |
| `MAILER_DRIVER` | `smtp` |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` / `SMTP_SECURE` | `465` / `1` |
| `SMTP_USER` | `avorextechnologies…` (a Gmail account) |
| `SMTP_FROM` | `Avorex AvoMessage <…>` |

So every OTP is sent **from a `@gmail.com` address, through Gmail's SMTP
relay**, on behalf of a product called AvoMessage.

## The part that cannot be fixed by configuration

SPF, DKIM and DMARC are **DNS records for the sending domain**. The sending
domain here is `gmail.com`, which Google owns. You cannot publish `_dmarc.gmail.com`
or a DKIM key for it, and you would not want to — Gmail's records already exist
and already pass for mail Google itself sends.

That leaves the actual problem, which is not authentication at all:

1. **The envelope domain is not yours.** Receivers see `avorextechnologies@gmail.com`
   as the sender. A brand name in the `From:` display name ("Avorex AvoMessage")
   on a `gmail.com` address is one of the oldest phishing shapes there is, and
   filters score it accordingly. No amount of template polish outweighs it.
2. **The domain has no reputation for transactional mail.** A personal Gmail
   account has no sending history for a service, no dedicated IP reputation,
   and is rate-limited by Google (roughly 500 recipients/day for a free account)
   — which is also a silent failure mode once signups grow.
3. **Google's own sending policy now requires authentication for bulk senders.**
   Mail that looks like a service but originates from a consumer mailbox sits on
   the wrong side of that line.

**Conclusion: the fix is to send from a domain you own.** Everything below
assumes that.

## The fix, in order

### 1. Choose a subdomain for transactional mail

Use a subdomain, not the root. `mail.yourdomain.com` or `em.yourdomain.com`.
Reputation for transactional mail is then isolated from any human mailbox on the
root domain — if the subdomain is ever marked, your normal email is unaffected.

Set `SMTP_FROM="AvoMessage <no-reply@mail.yourdomain.com>"`.

### 2. Publish the three records

Replace `mail.yourdomain.com` with your subdomain. The DKIM value is issued by
your provider — do not invent it.

**SPF** — authorises the relay to send for the subdomain.

```
Type:  TXT
Name:  mail
Value: v=spf1 include:<provider-spf-include> -all
```

Use `-all` (hard fail), not `~all`. One SPF record per name: if one already
exists, merge into it rather than adding a second.

**DKIM** — the cryptographic signature that survives forwarding.

```
Type:  TXT   (or CNAME, depending on the provider)
Name:  <selector>._domainkey.mail
Value: <public key issued by your provider>
```

Provider-issued, typically 2048-bit. Most providers give several selectors so
keys can be rotated without downtime.

**DMARC** — tells receivers what to do when SPF or DKIM fails, and where to send
reports.

```
Type:  TXT
Name:  _dmarc.mail
Value: v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com; adkim=s; aspf=s
```

Start at `p=none` deliberately. It is a monitoring policy: you receive aggregate
reports without any risk of legitimate mail being rejected while you are still
learning what your legitimate mail looks like. Move to `p=quarantine`, then
`p=reject`, only after the reports are clean — a week or two of real traffic.

### 3. Move off Gmail SMTP to a transactional provider

Gmail SMTP cannot send as your domain. Any of these can, and all three issue the
DKIM records above:

| provider | notes |
| --- | --- |
| **Resend** | already supported — this repo has a `ResendMailer`; set `MAILER_DRIVER=resend` and `RESEND_API_KEY` |
| SendGrid / Postmark / Mailgun | equivalent; SMTP credentials slot into the existing `smtp` driver |

The `resend` path is the shortest route: the driver is written, tested and
passes the plain-text part through, and Resend handles DKIM signing for the
domain you verify.

### 4. Verify, then watch

```bash
# Send to a Gmail address you control, then read the raw headers.
# You want all three:
#   spf=pass      (or the Received-SPF header)
#   dkim=pass     (with your selector)
#   dmarc=pass
```

Then subscribe a real address to `rua=` in the DMARC record and read the
aggregate reports. That is the only way to know whether the change worked for
recipients you do not control.

## What was fixed in the code

One real defect, on the exact driver production uses.

`SmtpMailer` sent `Content-Type: text/html` **alone** and dropped
`SendMailOptions.text` entirely — while the OTP template generates a plain-text
alternative specifically because *"some spam filters treat a missing text part
as a signal"*. The `resend` driver passed it through; the `smtp` driver threw it
away, so the two drivers disagreed about the same email.

Now `buildSmtpMessage` emits `multipart/alternative` with **both** parts, text
first (RFC 2046: the last part is the preferred one, so HTML-first would make
text-only clients render raw markup). `Reply-To` was added too — it defaults to
the bare `SMTP_FROM` and is overridable with `SMTP_REPLY_TO`.

Pinned by `tests/mailer-mime.test.ts`: both parts present, correct order,
boundary declared and closed, RFC 2047 encoding of non-ASCII headers, and no
body line that could be mistaken for the end-of-data marker.

## What is still not guaranteed

Gmail decides placement per recipient, using reputation signals that no sender
can see. A correctly authenticated, correctly configured sender still lands in
Spam sometimes — the goal is to remove every *avoidable* signal, not to promise
an inbox. Two things remain worth doing after the move:

- **Warm up slowly.** A brand-new sending domain with a sudden burst of mail
  looks like abuse. Signup OTP volume is naturally low, which helps.
- **Ask people to mark it "Not spam"** rather than just moving it. The mark is a
  reputation signal that actually feeds back.

## Environment variables

| variable | purpose |
| --- | --- |
| `MAILER_DRIVER` | `log` (dev) · `resend` · `smtp` |
| `SMTP_FROM` | the `From:` header. Must be on the verified domain |
| `SMTP_REPLY_TO` | `Reply-To:`. Defaults to the bare `SMTP_FROM` |
| `RESEND_API_KEY` | required by the `resend` driver |
| `APP_URL` | base URL for the links inside the email |
