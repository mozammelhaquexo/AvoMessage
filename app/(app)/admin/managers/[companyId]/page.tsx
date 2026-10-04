import type { Metadata } from "next";
import { AdminManagerCompany } from "@/components/admin/AdminManagerCompany";

export const metadata: Metadata = { title: "Admin — company managers" };

export default async function AdminManagerCompanyPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return <AdminManagerCompany companyId={companyId} />;
}
