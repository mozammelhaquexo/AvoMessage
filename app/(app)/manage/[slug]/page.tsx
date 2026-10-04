import type { Metadata } from "next";
import { ManageDashboard } from "@/components/manage/ManageDashboard";

export const metadata: Metadata = { title: "Company dashboard" };

export default function ManageDashboardPage() {
  return <ManageDashboard />;
}
