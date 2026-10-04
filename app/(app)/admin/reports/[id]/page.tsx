import type { Metadata } from "next";
import { AdminReportDetail } from "@/components/admin/AdminReports";

export const metadata: Metadata = { title: "Admin — report detail" };

export default async function AdminReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminReportDetail reportId={id} />;
}
