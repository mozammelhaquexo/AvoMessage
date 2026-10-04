import type { Metadata } from "next";
import { ManageAnalytics } from "@/components/manage/ManageAnalytics";

export const metadata: Metadata = { title: "Company analytics" };

export default function ManageAnalyticsPage() {
  return <ManageAnalytics />;
}