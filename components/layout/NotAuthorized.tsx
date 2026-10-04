/**
 * components/layout/NotAuthorized.tsx — server-rendered refusal.
 *
 * Deliberately a SERVER component with no interactivity: the point of the
 * server-side guards on /admin and /manage is that no privileged markup is
 * ever sent to a browser that is not allowed to see it. An interactive error
 * state would have to be a client component, which is the thing being avoided.
 */
import Link from "next/link";
import { Icon } from "@/components/ui";

export function NotAuthorized({
  title = "Not authorized",
  message,
}: {
  title?: string;
  message: string;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-20 text-center">
      <span
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger"
      >
        <Icon name="shield" size={26} />
      </span>
      <h1 className="mt-4 text-h2 font-bold tracking-tight text-ink">{title}</h1>
      <p className="mt-2 max-w-md text-body-sm text-ink-2">{message}</p>
      <Link
        href="/home"
        className="mt-6 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-cta px-4 text-body-sm font-semibold text-on-brand transition-opacity hover:opacity-90"
      >
        <Icon name="chevronLeft" size={16} aria-hidden />
        Back to home
      </Link>
    </div>
  );
}
