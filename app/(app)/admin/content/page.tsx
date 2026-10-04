import type { Metadata } from "next";
import { AdminContentPage } from "@/components/admin/AdminContentPage";

export const metadata: Metadata = { title: "Admin — content" };

export default function AdminContentRoute() {
  return <AdminContentPage />;
}
