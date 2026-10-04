import type { Metadata } from "next";
import { AdminAnalytics } from "@/components/admin/AdminAnalytics";

export const metadata: Metadata = { title: "Admin — analytics" };

export default function AdminAnalyticsPage() {
  return <AdminAnalytics />;
}
