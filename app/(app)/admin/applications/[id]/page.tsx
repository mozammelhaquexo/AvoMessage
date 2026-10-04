import type { Metadata } from "next";
import { AdminApplicationDetail } from "@/components/admin/AdminApplications";

export const metadata: Metadata = { title: "Admin — application detail" };

export default async function AdminApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AdminApplicationDetail applicationId={id} />;
}
