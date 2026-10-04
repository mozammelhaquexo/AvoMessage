import type { Metadata } from "next";
import { ManageInvitations } from "@/components/manage/ManageInvitations";

export const metadata: Metadata = { title: "Manage invitations" };

export default function ManageInvitationsPage() {
  return <ManageInvitations />;
}
