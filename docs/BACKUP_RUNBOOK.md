# Backup & recovery runbook

Everything that lives in the database is at risk of being lost: a paused
Supabase project, an accidental `DROP DATABASE`, a bad migration, an
over-zealous operator. This document is the playbook for **not** losing
data and for **getting it back** when something does.

---

## 1. Daily automatic backup

A Vercel Cron Job calls `POST /api/admin/backup` once a day at 02:00 UTC
(see `vercel.json`). The endpoint:

1. Reads every public user table with Prisma
2. Stores the snapshot under `snapshot:full:<UTC-ISO>` in **Vercel KV**
3. Trims to the last **30 snapshots** (KV free tier stays under a few MB)

`Session`, `PasswordReset` and `OtpChallenge` are intentionally **excluded**
from the snapshot — they hold live auth tokens / bcrypt hashes that should
never leave the database in plaintext form.

### Setup checklist (one-time)

- [x] `vercel.json` declares the cron schedule
- [ ] **Vercel KV is provisioned**: `vercel integration add upstash` (or
      add Upstash Redis from the Marketplace), then re-link the project
      so `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` land in
      the Production env
- [ ] `CRON_SECRET` is set in Vercel env (any 32+ char string). Vercel
      Cron will send `Authorization: Bearer ${CRON_SECRET}` automatically.
- [ ] Confirm the first run by hitting the endpoint:

      ```bash
      curl -i -X POST -H "Authorization: Bearer $CRON_SECRET" \
        https://avomessage.vercel.app/api/admin/backup
      ```

      Expect `200 { ok: true, key: "snapshot:full:…", rowCounts: {…} }`.

Until KV is wired, `apply-schema.mjs` still logs row counts pre/post (the
fallback forensic trail), but the daily snapshot is a no-op.

---

## 2. Manual snapshot (before any risky operation)

Always take a manual snapshot **immediately before** running anything that
could lose data: a destructive migration, a direct `psql` session, a
provider migration. Two options:

### a) On-demand API call

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://avomessage.vercel.app/api/admin/backup
```

### b) Local pg_dump

Requires the PostgreSQL client tools on PATH (no install on Windows by
default — `winget install postgresql` or use the same tool from WSL).

```bash
node scripts/backup-supabase.mjs                       # → backups/<timestamp>.sql.gz
node scripts/backup-supabase.mjs --label pre-migration # custom filename
node scripts/backup-supabase.mjs --stdout | aws s3 cp - s3://my-backups/   # offsite
```

Restore the dump with:

```bash
gunzip -c backups/avomessage-<label>.sql.gz | psql "$DATABASE_URL"
```

`pg_dump` is the more reliable option — it captures **everything** (schemas,
sequences, large objects, indexes, constraints) and survives a 500 MB
restore, while the Vercel-KV snapshot is capped to 5 000 rows/table for
speed.

---

## 3. Pre-migration row-count guardrail

`scripts/apply-schema.mjs` snapshots every table's row count **before**
and **after** it applies `supabase.sql`, and **aborts the build** if any
table went from >0 to fewer rows. The counts are persisted to Vercel KV
under `snapshot:pre:<deploy>` / `snapshot:post:<deploy>` so you can answer
"what did the DB look like at deploy d_abc?" after the fact.

This is a safety net, not a backup — it only catches the case where a
migration deleted rows, not where the entire database was reset.

---

## 4. Monitoring: row counts from `/api/health`

`/api/health` now returns:

```json
{
  "status": "ok",
  "db": {
    "ok": true,
    "latencyMs": 12,
    "schema": { "ok": true, "tableCount": 41 },
    "rows": { "User": 42, "Message": 1234, "Conversation": 8, ... }
  }
}
```

Point a monitoring endpoint at `/api/health` and alert when any value in
`db.rows` falls below its previous value by more than a threshold you pick
(50% overnight is suspicious, 100% drop in 5 minutes is almost certainly
a wipe). Free uptime monitors that work for this:

- UptimeRobot (5-minute interval, HTTP check, alert via webhook / Telegram)
- Better Stack (also fine)
- A cron job of your own that calls the endpoint and `git diff`s the
  result against the previous snapshot

---

## 5. Recovery — when something did go wrong

### a) Restore from a Vercel-KV snapshot (≤ 30 days old, only the tables
included in the snapshot, capped to 5 000 rows per table)

Inspect available snapshots:

```bash
node -e "fetch(process.env.UPSTASH_REDIS_REST_URL + '/keys/snapshot:full:*',
  { headers: { authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN } })
  .then(r => r.json()).then(console.log)"
```

Then re-insert with a small Node script — the snapshot is JSON with the
shape `{ at, rowCounts, tables: { [name]: rows[] } }`, so a one-page script
that walks `tables` and does `prisma.${name}.createMany({ data: rows })`
will rebuild it. Foreign-key order matters: sort the tables topologically
by their FKs first, or delete all rows and recreate from empty.

### b) Restore from a local `pg_dump` (recommended for big or full restores)

If you have a `.sql.gz` from `scripts/backup-supabase.mjs`:

```bash
gunzip -c backups/avomessage-pre-migration.sql.gz | psql "$DATABASE_URL"
```

This is a **full** restore (schema + data + constraints + indexes + sequences).
For partial restores, `pg_restore --table=<name>` works against `pg_dump -Fc`
archives; convert the plain-SQL dump with `pg_dump ... -Fc > out.dump`
first if you need that flexibility.

### c) Last resort: Supabase's own backups

Supabase **does not** include automatic backups on the free tier. On Pro
($25/mo) you get 7 days of daily backups under
**Database → Backups** in the dashboard, and Point-in-Time Recovery
($100/mo) on top of that. Worth it once you have users depending on the
service.

---

## 6. The single most important rule

**Take a snapshot before you do anything that could lose data, and
verify the snapshot is non-empty afterwards.**

The `apply-schema.mjs` row-count guardrail does the second half
automatically. The first half is on you — the on-demand curl in §2 is two
seconds of typing and saves you from weeks of recovery work.