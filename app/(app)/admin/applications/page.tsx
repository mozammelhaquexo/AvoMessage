import type { Metadata } from "next";
import { AdminApplications } from "@/components/admin/AdminApplications";

export const metadata: Metadata = { title: "Admin — applications" };

export default function AdminApplicationsPage() {
  return <AdminApplications />;
}
