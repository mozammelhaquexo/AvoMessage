import type { Metadata } from "next";
import { AdminRoles } from "@/components/admin/AdminRoles";

export const metadata: Metadata = { title: "Admin — roles" };

export default function AdminRolesPage() {
  return <AdminRoles />;
}
