import type { Metadata } from "next";
import { AdminPosts } from "@/components/admin/AdminContent";

export const metadata: Metadata = { title: "Admin — posts" };

export default function AdminPostsPage() {
  return <AdminPosts />;
}
