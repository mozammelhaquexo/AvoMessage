import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, CardContent, Icon } from "@/components/ui";
import { CreateCompanyForm } from "@/components/companies/CreateCompanyForm";
import { getServerSession } from "@/lib/server-session";
import { membershipStatusFor } from "@/lib/services/companies";
import { limitMessageFor } from "@/lib/services/company-membership-policy";

export const metadata: Metadata = { title: "New company" };

/**
 * The create form, behind the create gate.
 *
 * `/companies` already hides the button for someone who may not create one, but
 * this URL is typeable and bookmarkable, so the refusal has to live here too —
 * a page that renders a form which always fails on submit is worse than no page
 * at all. The decision is made on the server, from the same policy the POST
 * handler enforces, so the page and the endpoint can never disagree.
 *
 * The refusal is deliberately plain (no motion): it is a dead end, and the warm,
 * animated Bengali message belongs on `/companies`, where the person can
 * actually do something next.
 */
export default async function NewCompanyPage() {
  const session = await getServerSession();
  const status = session
    ? await membershipStatusFor(session.user.id, session.user.platformRole)
    : null;

  if (status && !status.canCreateCompany) {
    // Two different refusals, because the way out differs: not in a company at
    // all (ask a manager to add you) versus already at the cap (ask an
    // administrator to move you). `limitMessageFor` supplies the second line so
    // the wording matches the error the API would have returned.
    const inACompany = status.current > 0;

    return (
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand-strong">
              <Icon name="building" size={22} aria-hidden />
            </span>

            <h1 className="font-display text-h2 font-bold text-ink">
              {inACompany
                ? "আপনি ইতিমধ্যেই একটি কোম্পানিতে আছেন"
                : "কোম্পানি তৈরি করা যায় শুধু ম্যানেজারের জন্য"}
            </h1>

            <p className="text-body-sm leading-relaxed text-ink-2">
              {inACompany
                ? "একজন ইউজার সর্বোচ্চ একটি কোম্পানিতে থাকতে পারেন। অন্য কোম্পানিতে যোগ দিতে চাইলে অ্যাডমিনের সাথে যোগাযোগ করুন।"
                : "আপনাকে কোম্পানিতে যোগ করে দেবেন আপনার ম্যানেজার — আপনি নিজে কোম্পানি তৈরি করতে পারবেন না। তাঁর সাথে যোগাযোগ করুন।"}
            </p>

            <p className="text-body-sm leading-relaxed text-ink-3" lang="en">
              {limitMessageFor(status.tier, "self")}
            </p>

            <div className="mt-2 flex flex-wrap gap-2">
              <Button href="/companies" variant="outline">
                Back to companies
              </Button>
              <Link
                href="/settings/manager/apply"
                className="inline-flex items-center rounded-md px-3 py-2 text-body-sm font-medium text-brand-strong hover:underline"
              >
                Apply to become a manager
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <CreateCompanyForm />;
}
