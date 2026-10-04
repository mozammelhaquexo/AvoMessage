import type { Metadata } from "next";
import { AdminSettings } from "@/components/admin/AdminSettings";

export const metadata: Metadata = { title: "Admin — settings" };

export default function AdminSettingsPage() {
  return <AdminSettings />;
}
