import type { Metadata } from "next";
import { AdminReports } from "@/components/admin/AdminReports";

export const metadata: Metadata = { title: "Admin — reports" };

export default function AdminReportsPage() {
  return <AdminReports />;
}
