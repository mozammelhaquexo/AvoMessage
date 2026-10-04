import type { Metadata } from "next";
import { ManageAnnouncements } from "@/components/manage/ManageAnnouncements";

export const metadata: Metadata = { title: "Company announcements" };

export default function ManageAnnouncementsPage() {
  return <ManageAnnouncements />;
}