import type { Metadata } from "next";
import { AdminAnnouncements } from "@/components/admin/AdminAnnouncements";

export const metadata: Metadata = { title: "Admin — announcements" };

export default function AdminAnnouncementsPage() {
  return <AdminAnnouncements />;
}
