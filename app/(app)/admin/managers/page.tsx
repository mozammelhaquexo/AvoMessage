import type { Metadata } from "next";
import { AdminManagers } from "@/components/admin/AdminManagers";

export const metadata: Metadata = { title: "Admin — managers" };

export default function AdminManagersPage() {
  return <AdminManagers />;
}
