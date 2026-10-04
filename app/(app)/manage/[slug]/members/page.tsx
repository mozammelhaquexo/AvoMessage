import type { Metadata } from "next";
import { ManageMembers } from "@/components/manage/ManageMembers";

export const metadata: Metadata = { title: "Manage members" };

export default function ManageMembersPage() {
  return <ManageMembers />;
}
