import type { Metadata } from "next";
import { AdminAuditLogs } from "@/components/admin/AdminAuditLogs";

export const metadata: Metadata = { title: "Admin — audit logs" };

export default function AdminAuditLogsPage() {
  return <AdminAuditLogs />;
}
