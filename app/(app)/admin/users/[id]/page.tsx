import type { Metadata } from "next";
import { AdminUserDetail } from "@/components/admin/AdminUserDetail";

export const metadata: Metadata = { title: "Admin — user detail" };

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminUserDetail userId={id} />;
}
