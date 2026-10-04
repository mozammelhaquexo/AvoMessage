import type { Metadata } from "next";
import { ManageSettings } from "@/components/manage/ManageSettings";

export const metadata: Metadata = { title: "Company settings" };

export default function ManageSettingsPage() {
  return <ManageSettings />;
}
