/**
 * app/(app)/notifications/page.tsx — notification center.
 */
import type { Metadata } from "next";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <NotificationCenter />
    </div>
  );
}
