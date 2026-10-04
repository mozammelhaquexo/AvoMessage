import type { Metadata } from "next";
import { ManageJoinRequests } from "@/components/manage/ManageJoinRequests";

export const metadata: Metadata = { title: "Join requests" };

export default function ManageJoinRequestsPage() {
  return <ManageJoinRequests />;
}