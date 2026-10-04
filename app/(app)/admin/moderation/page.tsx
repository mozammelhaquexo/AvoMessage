import type { Metadata } from "next";
import { AdminModeration } from "@/components/admin/AdminModeration";

export const metadata: Metadata = { title: "Admin — moderation" };

export default function AdminModerationPage() {
  return <AdminModeration />;
}
