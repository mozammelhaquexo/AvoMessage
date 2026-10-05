/**
 * components/settings/ManagerSection.tsx — the "Manager" tab in Settings.
 *
 * The applicant-facing half of feature 10. The form itself lives on its own
 * page (`/settings/manager/apply`) because it collects a lot of detail; this
 * tab is the status view and the entry point.
 *
 * The server owns the state machine, so this component never guesses: it
 * renders whatever `/api/manager-applications` reports.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, ConfirmDialog, ErrorState, Icon, Skeleton, toast } from "@/components/ui";
import { apiDelete, apiGet, ApiError } from "@/lib/api-client";
import { formatRelative } from "@/lib/chat";
import { isCompanyManagerRole } from "@/lib/company-roles";
import { useIsAdmin } from "@/lib/auth-client";
import type { ManagerApplicationItem, ManagerApplicationStatus } from "@/lib/api-types";

const STATUS_META: Record<
  ManagerApplicationStatus,
  { label: string; variant: "warning" | "success" | "danger" | "neutral"; blurb: string }
> = {
  PENDING: {
    label: "Under review",
    variant: "warning",
    blurb: "An administrator is reviewing your application.",
  },
  APPROVED: {
    label: "Approved",
    variant: "success",
    // Overridden below when the approval is not tied to a company — a manager
    // creates their own company, so "the panel is in your sidebar" would be a
    // lie until they do.
    blurb: "You're a company manager. The Manager Panel is in your sidebar.",
  },
  DECLINED: {
    label: "Not approved",
    variant: "danger",
    blurb: "Your application was declined. You can apply again with updated details.",
  },
  WITHDRAWN: {
    label: "Withdrawn",
    variant: "neutral",
    blurb: "You withdrew this application. You can apply again at any time.",
  },
};

export function ManagerSection() {
  const isAdmin = useIsAdmin();
  const [application, setApplication] = useState<ManagerApplicationItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setApplication(await apiGet<ManagerApplicationItem | null>("/api/manager-applications"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your application");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function withdraw() {
    if (!application) return;
    setBusy(true);
    try {
      await apiDelete(`/api/manager-applications/${application.id}`);
      setConfirmWithdraw(false);
      toast({ variant: "success", title: "Application withdrawn" });
      await load();
    } catch (e) {
      toast({
        variant: "error",
        title:
          e instanceof ApiError && e.code === "ALREADY_REVIEWED"
            ? "This application has already been decided."
            : e instanceof Error
              ? e.message
              : "Could not withdraw the application",
      });
    } finally {
      setBusy(false);
    }
  }

  /*
   * An administrator never applies. They already hold the highest platform
   * role, and the company-creation policy already treats them as the ADMIN
   * tier — the only thing standing between them and a Manager Panel is a
   * company, which they create themselves. So the tab shows the one action
   * that is actually useful instead of a form whose approval would be a
   * formality ("admin nijei admin abar nijei manager hoy").
   */
  if (isAdmin) return <AdminManagerAccess />;

  if (loading) {
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Couldn't load your application"
        message={error}
        retryLabel="Try again"
        onRetry={() => void load()}
      />
    );
  }

  /* ── No application yet ──────────────────────────────────────────────── */

  if (!application) {
    return (
      <div className="flex flex-col gap-4">
        <IntroCard />
        <div className="rounded-lg border border-line bg-surface p-5">
          <h2 className="text-h3 font-semibold text-ink">Apply to become a manager</h2>
          <p className="mt-1 text-body-sm text-ink-2">
            You&apos;ll fill in the company, your position, and the size of the team you&apos;d run.
            An administrator reviews every application by hand.
          </p>
          <Button href="/settings/manager/apply" className="mt-4">
            <Icon name="shield" size={16} aria-hidden className="mr-1.5" />
            Start application
          </Button>
        </div>
      </div>
    );
  }

  const meta = STATUS_META[application.status];
  const approvedWithoutCompany =
    application.status === "APPROVED" && !application.company;

  return (
    <div className="flex flex-col gap-4">
      <IntroCard />

      {/* Status */}
      <section className="rounded-lg border border-line bg-surface p-5" aria-labelledby="mgr-status">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="mgr-status" className="flex items-center gap-2 text-h3 font-semibold text-ink">
            <Icon name="shield" size={18} aria-hidden className="text-ink-3" />
            Application status
          </h2>
          <Badge variant={meta.variant} role="status">
            {meta.label}
          </Badge>
        </div>
        <p className="mt-2 text-body-sm text-ink-2">
          {approvedWithoutCompany
            ? "You're approved as a manager. Create your company to open the Manager Panel."
            : meta.blurb}
        </p>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-body-sm sm:grid-cols-2">
          <Field label="Company" value={application.companyName} />
          <Field label="Position" value={application.position} />
          <Field label="Company size" value={`${application.companySize} people`} />
          <Field label="Teams you'd run" value={`${application.teamCount}`} />
          <Field label="People per team" value={`${application.teamSize}`} />
          <Field label="Submitted" value={formatRelative(application.createdAt)} />
        </dl>

        {application.message && (
          <div className="mt-4">
            <dt className="text-caption font-medium text-ink-2">Your note</dt>
            <dd className="mt-1 whitespace-pre-wrap rounded-md border border-line bg-surface-2 px-3 py-2 text-body-sm text-ink-2">
              {application.message}
            </dd>
          </div>
        )}

        {application.reviewNote && application.status !== "PENDING" && (
          <div className="mt-4 rounded-md border border-line bg-surface-2 px-3 py-2.5">
            <p className="text-caption font-medium text-ink-2">
              Reviewer&apos;s note
              {application.reviewer ? ` · ${application.reviewer.name}` : ""}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-body-sm text-ink-2">
              {application.reviewNote}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="mt-5 flex flex-wrap gap-2">
          {application.status === "APPROVED" && application.company && (
            <Button href={`/manage/${application.company.slug}`}>
              <Icon name="chart" size={16} aria-hidden className="mr-1.5" />
              Open Manager Panel
            </Button>
          )}
          {approvedWithoutCompany && (
            <Button href="/companies/new">
              <Icon name="building" size={16} aria-hidden className="mr-1.5" />
              Create your company
            </Button>
          )}
          {application.status === "PENDING" && (
            <Button variant="outline" onClick={() => setConfirmWithdraw(true)}>
              Withdraw application
            </Button>
          )}
          {(application.status === "DECLINED" || application.status === "WITHDRAWN") && (
            <Button href="/settings/manager/apply">Apply again</Button>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={confirmWithdraw}
        onOpenChange={setConfirmWithdraw}
        title="Withdraw this application?"
        description="The reviewers will no longer see it. You can submit a new one at any time."
        confirmLabel="Withdraw"
        tone="danger"
        icon="logout"
        confirming={busy}
        onConfirm={() => void withdraw()}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption font-medium text-ink-3">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

/**
 * What an administrator sees on Settings → Manager.
 *
 * Full access, stated plainly, plus whichever single next step applies: open
 * the console they already have, or create the company that gives them one.
 * The application form is not shown at all — an administrator filing a request
 * for another administrator to approve would be a loop with no purpose, and
 * the copy says so rather than leaving them to wonder why the tab is empty.
 */
function AdminManagerAccess() {
  const [slug, setSlug] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ company: { slug: string }; role: string }[]>("/api/companies")
      .then((rows) => {
        if (cancelled) return;
        setSlug(rows.find((m) => isCompanyManagerRole(m.role))?.company.slug ?? null);
      })
      .catch(() => {
        if (!cancelled) setSlug(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400"
          >
            <Icon name="shield" size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-h3 font-semibold text-ink">
              আপনি প্ল্যাটফর্ম অ্যাডমিন — সম্পূর্ণ অ্যাক্সেস আছে
            </h2>
            <p className="mt-1.5 text-body-sm leading-relaxed text-ink-2">
              আপনার ম্যানেজার হওয়ার জন্য আবেদন করার দরকার নেই, এবং কোনো ম্যানেজারের অনুমতিও
              লাগবে না। আপনি নিজেই আপনার কোম্পানি তৈরি করতে পারবেন — কোম্পানি তৈরি হওয়ার সাথে
              সাথেই আপনার সাইডবারে Manager Panel চালু হয়ে যাবে।
            </p>
            <p className="mt-2 text-caption text-ink-3" lang="en">
              Platform administrator · full access · no manager approval required
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {slug === undefined ? (
            <Skeleton className="h-11 w-52 rounded-lg" />
          ) : slug ? (
            <>
              <Button href={`/manage/${slug}`}>
                <Icon name="chart" size={16} aria-hidden className="mr-1.5" />
                Open Manager Panel
              </Button>
              <Button href="/companies/new" variant="outline">
                <Icon name="building" size={16} aria-hidden className="mr-1.5" />
                Create another company
              </Button>
            </>
          ) : (
            <Button href="/companies/new">
              <Icon name="building" size={16} aria-hidden className="mr-1.5" />
              কোম্পানি তৈরি করুন
            </Button>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface-2 p-4">
        <h3 className="flex items-center gap-2 text-body-sm font-semibold text-ink">
          <Icon name="info" size={16} aria-hidden className="text-ink-3" />
          Admin panel-এ Manager Section কোথায়?
        </h3>
        <p className="mt-2 text-body-sm text-ink-2">
          Admin panel → <span className="font-medium text-ink">Managers</span> — সেখানে
          কোম্পানিগুলোর তালিকা আর প্রতিটির ম্যানেজার সংখ্যা দেখতে পাবেন। নতুন আবেদনগুলো
          <span className="font-medium text-ink"> Applications</span>-এ আসে।
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button href="/admin/managers" variant="outline" size="sm">
            <Icon name="shield" size={15} aria-hidden className="mr-1.5" />
            Managers
          </Button>
          <Button href="/admin/applications" variant="outline" size="sm">
            <Icon name="send" size={15} aria-hidden className="mr-1.5" />
            Applications
          </Button>
        </div>
      </section>
    </div>
  );
}

function IntroCard() {
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-4">
      <h2 className="flex items-center gap-2 text-body-sm font-semibold text-ink">
        <Icon name="info" size={16} aria-hidden className="text-ink-3" />
        What a manager can do
      </h2>
      <ul className="mt-2 flex flex-col gap-1 text-body-sm text-ink-2">
        <li>· Manage members, teams and join requests for one company</li>
        <li>· Post company announcements and company-only updates</li>
        <li>· See the company activity log and analytics</li>
      </ul>
      <p className="mt-2 text-caption text-ink-3">
        A manager can never access the platform admin console.
      </p>
    </div>
  );
}
