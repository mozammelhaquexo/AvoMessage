/**
 * app/(app)/settings/manager/apply/page.tsx — the full manager application form.
 *
 * Reached from Settings → Manager. The status view lives in the tab; this page
 * exists only to collect the detail an admin needs to make a decision, which is
 * why it is a separate route rather than an inline form.
 *
 * Client validation mirrors `managerApplicationSchema`; the server is the
 * authority and its field errors are surfaced verbatim.
 */
"use client";

import { useCallback, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, FormField, Icon, Input, Textarea } from "@/components/ui";
import { BackLink } from "@/components/layout/AppShell";
import { ManagerApplySuccess } from "@/components/settings/ManagerApplySuccess";
import { apiPost, ApiError } from "@/lib/api-client";

interface Values {
  companyName: string;
  position: string;
  companySize: string;
  teamCount: string;
  teamSize: string;
  message: string;
}

const EMPTY: Values = {
  companyName: "",
  position: "",
  companySize: "",
  teamCount: "",
  teamSize: "",
  message: "",
};

/** "" is allowed (means 0); anything else must be a non-negative integer. */
function parseCount(raw: string, label: string): { value: number } | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: 0 };
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0) {
    return { error: `${label} must be a whole number of 0 or more.` };
  }
  if (n > 1_000_000) return { error: `${label} looks too large.` };
  return { value: n };
}

export default function ManagerApplyPage() {
  const router = useRouter();
  const [values, setValues] = useState<Values>(EMPTY);
  const [touched, setTouched] = useState<Record<keyof Values, boolean>>({
    companyName: false,
    position: false,
    companySize: false,
    teamCount: false,
    teamSize: false,
    message: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  /**
   * Set once the server has accepted the application. It renders the centred
   * Bengali confirmation (see ManagerApplySuccess) and is the ONLY thing that
   * navigates afterwards — the old code pushed to Settings immediately, so the
   * confirmation and the redirect raced and the message was never read.
   */
  const [submitted, setSubmitted] = useState(false);

  const errors: Record<keyof Values, string | null> = {
    companyName:
      values.companyName.trim().length < 2 ? "Enter the company name." : null,
    position: values.position.trim().length < 2 ? "Enter your position." : null,
    companySize: errorOrNull(parseCount(values.companySize, "Company size")),
    teamCount: errorOrNull(parseCount(values.teamCount, "Number of teams")),
    teamSize: errorOrNull(parseCount(values.teamSize, "People per team")),
    message: values.message.length > 1000 ? "Keep it under 1000 characters." : null,
  };

  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));
  const blur = (key: keyof Values) => () => setTouched((t) => ({ ...t, [key]: true }));

  const show = (key: keyof Values) => (touched[key] ? errors[key] ?? undefined : undefined);

  /** Where the confirmation sends the applicant once it has been read. */
  const finish = useCallback(() => {
    router.push("/settings?tab=manager");
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched({
      companyName: true,
      position: true,
      companySize: true,
      teamCount: true,
      teamSize: true,
      message: true,
    });
    if (Object.values(errors).some(Boolean)) return;

    setSubmitting(true);
    setServerError(null);
    try {
      const counts = {
        companySize: parseCount(values.companySize, "Company size"),
        teamCount: parseCount(values.teamCount, "Number of teams"),
        teamSize: parseCount(values.teamSize, "People per team"),
      };
      await apiPost("/api/manager-applications", {
        companyName: values.companyName.trim(),
        position: values.position.trim(),
        companySize: "value" in counts.companySize ? counts.companySize.value : 0,
        teamCount: "value" in counts.teamCount ? counts.teamCount.value : 0,
        teamSize: "value" in counts.teamSize ? counts.teamSize.value : 0,
        ...(values.message.trim() ? { message: values.message.trim() } : {}),
      });
      setSubmitted(true);
    } catch (err) {
      // "You already have one under review" is not a failure the applicant
      // needs to act on — their application IS in, which is exactly what the
      // confirmation says. Any other error stays on the form.
      if (err instanceof ApiError && err.code === "APPLICATION_PENDING") {
        setSubmitted(true);
        return;
      }
      setServerError(err instanceof Error ? err.message : "Could not submit your application.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      {/* Fixed-position overlay, so its place in the tree is irrelevant to
          layout — it is the first child only so that it reads first. */}
      <ManagerApplySuccess open={submitted} onDone={finish} />
      <BackLink href="/settings?tab=manager" label="Back to Settings" />

      <header>
        <h1 className="text-h1 font-bold tracking-tight">Apply to become a manager</h1>
        <p className="mt-1 text-body-sm text-ink-2">
          Tell us about the company and the team you&apos;d run. An administrator reviews
          every application by hand — nothing is granted automatically.
        </p>
      </header>

      <form onSubmit={submit} noValidate className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-5">
        {serverError && (
          <p
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-body-sm font-medium text-danger-strong"
          >
            {serverError}
          </p>
        )}

        <FormField
          label="Company"
          required
          error={show("companyName")}
          hint="The company you'd manage. It doesn't have to exist yet — once you're approved, you create it yourself."
        >
          {({ id, ...fp }) => (
            <Input
              id={id}
              {...fp}
              value={values.companyName}
              onChange={set("companyName")}
              onBlur={blur("companyName")}
              placeholder="Acme Corp"
              maxLength={120}
              autoComplete="organization"
            />
          )}
        </FormField>

        <FormField label="Your position" required error={show("position")}>
          {({ id, ...fp }) => (
            <Input
              id={id}
              {...fp}
              value={values.position}
              onChange={set("position")}
              onBlur={blur("position")}
              placeholder="Head of Operations"
              maxLength={120}
            />
          )}
        </FormField>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <FormField label="Company size" error={show("companySize")} hint="People total">
            {({ id, ...fp }) => (
              <Input
                id={id}
                {...fp}
                type="number"
                min={0}
                inputMode="numeric"
                value={values.companySize}
                onChange={set("companySize")}
                onBlur={blur("companySize")}
                placeholder="0"
              />
            )}
          </FormField>

          <FormField label="Teams you'd run" error={show("teamCount")} hint="How many">
            {({ id, ...fp }) => (
              <Input
                id={id}
                {...fp}
                type="number"
                min={0}
                inputMode="numeric"
                value={values.teamCount}
                onChange={set("teamCount")}
                onBlur={blur("teamCount")}
                placeholder="0"
              />
            )}
          </FormField>

          <FormField label="People per team" error={show("teamSize")} hint="Average">
            {({ id, ...fp }) => (
              <Input
                id={id}
                {...fp}
                type="number"
                min={0}
                inputMode="numeric"
                value={values.teamSize}
                onChange={set("teamSize")}
                onBlur={blur("teamSize")}
                placeholder="0"
              />
            )}
          </FormField>
        </div>

        <FormField
          label="Why you?"
          error={show("message")}
          hint="Optional — anything that helps the reviewer decide."
        >
          {({ id, ...fp }) => (
            <Textarea
              id={id}
              {...fp}
              rows={4}
              value={values.message}
              onChange={set("message")}
              onBlur={blur("message")}
              maxLength={1000}
              placeholder="I've run the operations team for three years and…"
            />
          )}
        </FormField>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={submitting}>
            <Icon name="send" size={16} aria-hidden className="mr-1.5" />
            Submit application
          </Button>
          <Link href="/settings?tab=manager" className="text-body-sm font-medium text-ink-2 hover:underline">
            Cancel
          </Link>
        </div>

        <p className="text-caption text-ink-3">
          You can withdraw a pending application from Settings at any time. A manager never
          gains access to the platform admin console.
        </p>
      </form>
    </div>
  );
}

function errorOrNull(result: { value: number } | { error: string }): string | null {
  return "error" in result ? result.error : null;
}
