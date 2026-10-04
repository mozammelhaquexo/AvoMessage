import type { Metadata } from "next";
import { ManageTeams } from "@/components/manage/ManageTeams";

export const metadata: Metadata = { title: "Manage teams" };

export default function ManageTeamsPage() {
  return <ManageTeams />;
}
