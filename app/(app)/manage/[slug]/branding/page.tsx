import type { Metadata } from "next";
import { ManageBranding } from "@/components/manage/ManageBranding";

export const metadata: Metadata = { title: "Company branding" };

export default function ManageBrandingPage() {
  return <ManageBranding />;
}