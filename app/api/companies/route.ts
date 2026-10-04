import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { created, handle, ok, parseJson } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { createCompany, listMyCompanies } from "@/lib/services/companies";
import { companyCreateSchema } from "@/lib/validation";

export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  return ok(await listMyCompanies(user));
});

export const POST = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const input = await parseJson(req, companyCreateSchema);
  return created(await createCompany(user, input, { ip: auditIp(req) }));
});
