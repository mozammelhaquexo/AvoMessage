import type { Metadata } from "next";
import { TeamPage } from "@/components/teams/TeamPage";

export const metadata: Metadata = { title: "Team" };

export default async function CompanyTeamPage({
  params,
}: {
  params: Promise<{ slug: string; teamId: string }>;
}) {
  const { slug, teamId } = await params;
  return <TeamPage slug={slug} teamId={teamId} />;
}
