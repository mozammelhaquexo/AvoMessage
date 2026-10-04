/**
 * app/(public)/terms/page.tsx — Terms and Conditions.
 *
 * Linked from the sign-up "I agree" checkbox, which is why it must render for
 * a logged-OUT visitor. It is also linked from Settings, so `/terms` is in the
 * (public) layout's authed allowlist.
 *
 * Deliberately a server component with no interactivity: it is a document.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui";

export const metadata: Metadata = {
  title: "Terms and Conditions",
  description: "The rules for using AvoMessage.",
};

const UPDATED = "3 October 2026";

export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <Link
        href="/signup"
        className="inline-flex min-h-11 items-center gap-1.5 text-body-sm font-medium text-ink-2 hover:text-ink"
      >
        <Icon name="chevronLeft" size={18} aria-hidden />
        Back to sign up
      </Link>

      <header className="mt-4">
        <h1 className="text-h1 font-bold tracking-tight text-ink">Terms and Conditions</h1>
        <p className="mt-2 text-body-sm text-ink-3">Last updated {UPDATED}</p>
      </header>

      <div className="prose-avo mt-8 flex flex-col gap-8 text-body-sm leading-relaxed text-ink-2">
        <Section title="1. Accepting these terms">
          <p>
            By creating an AvoMessage account, or by using AvoMessage in any way, you agree to
            these terms. If you do not agree, do not create an account and do not use the
            service.
          </p>
          <p>
            You must be at least 13 years old to use AvoMessage. If you are below the age of
            majority where you live, you may only use AvoMessage with the involvement of a parent
            or guardian.
          </p>
        </Section>

        <Section title="2. Your account">
          <p>
            You are responsible for the accuracy of the information on your account and for
            keeping your password secret. You are responsible for everything done through your
            account.
          </p>
          <p>
            Usernames are unique and are allocated on a first-come basis. We may reclaim a
            username that impersonates another person or organisation, or that is inactive for an
            extended period.
          </p>
          <p>
            You can delete your account at any time from Settings. We may suspend or close an
            account that repeatedly or seriously breaches these terms.
          </p>
        </Section>

        <Section title="3. What you may not do">
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li>Post content that is unlawful, hateful, harassing, or sexually exploitative.</li>
            <li>Impersonate a person, company, or AvoMessage itself.</li>
            <li>Share another person&apos;s private information without their consent.</li>
            <li>Send spam, run scams, or use automated means to inflate activity.</li>
            <li>Attempt to break, overload, or gain unauthorised access to the service.</li>
            <li>Scrape or bulk-export other users&apos; content without permission.</li>
          </ul>
          <p>
            Content that breaches these rules may be removed, and the account responsible may be
            suspended. Serious cases may be reported to the relevant authorities.
          </p>
        </Section>

        <Section title="4. Your content">
          <p>
            You keep ownership of everything you post. You grant us the licence we need to store,
            copy, and display that content so the service can work — for example, showing your
            post to the people who are allowed to see it, and backing it up.
          </p>
          <p>
            That licence ends when you delete the content, except where a copy must be retained
            for a legal obligation, or where another user has already forwarded or quoted it.
          </p>
          <p>
            You confirm that you have the right to post what you post, and that it does not
            infringe anyone else&apos;s rights.
          </p>
        </Section>

        <Section title="5. Companies and managers">
          <p>
            A company workspace has an owner and may have managers. A manager can see and moderate
            company content, and can add or remove members. If you leave a company, or a manager
            removes you, you lose access to that company&apos;s teams, group conversations, and
            private feed.
          </p>
          <p>
            Becoming a manager requires an application that a platform administrator reviews.
            Approving an application grants the manager role for one specific company. A manager
            never gains access to the platform administration console.
          </p>
          <p>
            If you are the last owner of a company, you cannot leave it until you transfer
            ownership to somebody else. This prevents a company from being left without anyone who
            can administer it.
          </p>
        </Section>

        <Section title="6. Privacy and messaging">
          <p>
            Direct messages are visible to the people in the conversation. Do not treat AvoMessage
            as a secure channel for secrets — treat it as you would any other messaging app.
          </p>
          <p>
            We record sign-in activity and security events so you can see who has accessed your
            account. You can review and revoke active sessions at any time from Settings.
          </p>
        </Section>

        <Section title="7. Notifications">
          <p>
            You control which notifications you receive from Settings. A small number of messages
            are always delivered because they are part of the service itself — for example, the
            outcome of an application you submitted, and platform messages from the AvoMessage
            team. These cannot be switched off.
          </p>
        </Section>

        <Section title="8. Availability and changes">
          <p>
            We aim to keep AvoMessage available, but we do not promise uninterrupted service. We
            may change or discontinue features. If we make a material change to these terms, we
            will tell you in the app before it takes effect.
          </p>
        </Section>

        <Section title="9. Ending this agreement">
          <p>
            You may stop using AvoMessage at any time and delete your account. We may suspend or
            end your access if you breach these terms. Sections 4 and 10 survive the end of this
            agreement.
          </p>
        </Section>

        <Section title="10. Liability">
          <p>
            AvoMessage is provided &ldquo;as is&rdquo;. To the extent the law allows, we are not
            liable for indirect or consequential loss arising from your use of the service,
            including lost content. Nothing in these terms limits liability that cannot lawfully
            be limited.
          </p>
        </Section>

        <Section title="11. Contact">
          <p>
            Questions about these terms, or a request about your content or account, can be raised
            through <Link href="/help" className="font-medium text-brand-strong hover:underline">Help &amp; Support</Link>.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h3 font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}
