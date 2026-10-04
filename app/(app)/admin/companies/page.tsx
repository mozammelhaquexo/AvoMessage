import { redirect } from "next/navigation";

/**
 * The old standalone Companies section is gone (request 5) — it was merged into
 * `/admin/managers`, which lists every company with its manager count and
 * drills into the full page.
 *
 * `next.config.ts` already redirects this path at the routing layer, so this
 * component normally never runs; it is kept as the in-app fallback so the route
 * still lands somewhere sensible if that config entry is ever removed.
 *
 * `components/admin/AdminCompanies.tsx` is the superseded page component. It is
 * left on disk deliberately (this workspace is not a git repo, so deleting it
 * could not be undone) and is no longer imported anywhere.
 */
export default function AdminCompaniesPage() {
  redirect("/admin/managers");
}
