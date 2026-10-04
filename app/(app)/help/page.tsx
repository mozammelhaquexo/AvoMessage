/**
 * app/(app)/help/page.tsx — help & support center.
 * FAQ accordion, quick links, and a "report a problem" shortcut that opens
 * the report dialog against your own account context (routed to moderators).
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, Icon } from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { useSession } from "@/lib/auth-client";

const FAQS: { q: string; a: string }[] = [
  {
    q: "How do I verify my email?",
    a: "We send a verification link right after signup. Click it within 24 hours. If it expired, use the Resend button in the banner at the top of the app (or on the verify-email page). Until verified, posting, commenting, and messaging are disabled.",
  },
  {
    q: "What's the difference between Home and World?",
    a: "Home shows posts from people you follow (plus your own). World shows public posts from the whole community — switch between Latest and For you ordering with the toggle at the top.",
  },
  {
    q: "Who can see my posts?",
    a: "You choose per post: Public (anyone), Followers (only your followers), Company (only members of the selected company), or Only me. Company posts are enforced server-side and never appear in the World feed.",
  },
  {
    q: "How do I start a conversation?",
    a: "Open someone's profile and tap Message. If you've chatted before, the existing conversation reopens. Group chats and company chats live under Messages too.",
  },
  {
    q: "Someone is bothering me. What can I do?",
    a: "From their profile, tap the ••• menu: Mute hides their posts from your feeds, Block prevents all contact both ways, and Report sends the account to our moderation team for review.",
  },
  {
    q: "How do sessions and devices work?",
    a: "Every login creates a session you can see under Settings → Security → Sessions & devices. Revoke any session you don't recognize, or sign out all other devices at once. Changing your password signs out every other device automatically.",
  },
  {
    q: "I forgot my password.",
    a: "Use the “Forgot your password?” link on the login page. You'll get a reset link by email that's valid for 1 hour and can only be used once.",
  },
  {
    q: "How do company workspaces work?",
    a: "Join or create a company under Companies. Members get a private feed, teams, and announcements. Managers can invite members and moderate company content; everything company-private stays invisible to outsiders.",
  },
];

const QUICK_LINKS = [
  { href: "/settings", icon: "settings", title: "Account settings", body: "Profile, privacy, notifications, security" },
  { href: "/world", icon: "globe", title: "Explore the World feed", body: "Discover people and conversations" },
  { href: "/companies", icon: "building", title: "Your companies", body: "Workspaces, teams, and invites" },
  { href: "/notifications", icon: "bell", title: "Notifications", body: "Catch up on what you missed" },
] as const;

export default function HelpPage() {
  const { user } = useSession();
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-h1 font-bold tracking-tight">Help & Support</h1>
        <p className="mt-1 text-body-sm text-ink-2">
          Answers to common questions{user ? `, ${user.name.split(" ")[0]}` : ""}. Still stuck? Report a problem from any post, comment, or profile and our moderators will take a look.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {QUICK_LINKS.map((l) => (
          <Link key={l.href} href={l.href}>
            <Card className="flex h-full items-center gap-3 p-4 transition-shadow duration-base hover:shadow-md">
              <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-strong">
                <Icon name={l.icon} size={20} />
              </span>
              <span>
                <span className="block text-body-sm font-semibold text-ink">{l.title}</span>
                <span className="block text-caption text-ink-3">{l.body}</span>
              </span>
            </Card>
          </Link>
        ))}
      </div>

      <section aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="text-h2 font-bold">
          Frequently asked questions
        </h2>
        <div className="mt-3 flex flex-col gap-2">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <Card key={f.q} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${i}`}
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
                >
                  <span className="text-body-sm font-semibold text-ink">{f.q}</span>
                  <Icon
                    name="chevronDown"
                    size={18}
                    aria-hidden
                    className={cn("shrink-0 text-ink-3 transition-transform duration-fast", isOpen && "rotate-180")}
                  />
                </button>
                <div
                  id={`faq-panel-${i}`}
                  hidden={!isOpen}
                  className="border-t border-line px-4 py-3.5 text-body-sm leading-relaxed text-ink-2"
                >
                  {f.a}
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <Card className="bg-brand-gradient-soft p-5">
        <h2 className="text-h3 font-bold">Safety first</h2>
        <p className="mt-1.5 text-body-sm text-ink-2">
          If someone is harassing you or posting harmful content, use <strong>Report</strong> on the
          post, comment, or profile. Every report is reviewed by a human moderator, and reporters
          are notified of the outcome.
        </p>
      </Card>
    </div>
  );
}
