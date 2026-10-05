/**
 * app/(app)/notifications/page.tsx — notification center.
 *
 * `max-w-5xl`, not the old `max-w-3xl`. The page is the only thing in the
 * content column (the right rail is Home-only), so a 768px list floated in a
 * 1392px column left ~310px of dead space on each side at 1920px wide. 1024px
 * cuts that to ~185px without stretching a single-column list to a width the
 * eye cannot track across.
 */
import type { Metadata } from "next";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <NotificationCenter />
    </div>
  );
}
