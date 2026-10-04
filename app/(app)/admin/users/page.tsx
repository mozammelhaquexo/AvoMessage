import type { Metadata } from "next";
import { AdminUsers } from "@/components/admin/AdminUsers";

export const metadata: Metadata = { title: "Admin — users" };

export default function AdminUsersPage() {
  return <AdminUsers />;
}
