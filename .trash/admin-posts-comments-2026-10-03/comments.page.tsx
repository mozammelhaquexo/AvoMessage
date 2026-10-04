import type { Metadata } from "next";
import { AdminComments } from "@/components/admin/AdminContent";

export const metadata: Metadata = { title: "Admin — comments" };

export default function AdminCommentsPage() {
  return <AdminComments />;
}
