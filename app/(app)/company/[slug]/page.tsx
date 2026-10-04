import type { Metadata } from "next";
import { CompanyWorkspace } from "@/components/companies/CompanyWorkspace";

export const metadata: Metadata = { title: "Company" };

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <CompanyWorkspace slug={slug} />;
}
