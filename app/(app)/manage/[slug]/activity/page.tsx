import type { Metadata } from "next";
import { ManageActivity } from "@/components/manage/ManageActivity";

export const metadata: Metadata = { title: "Company activity" };

export default function ManageActivityPage() {
  return <ManageActivity />;
}