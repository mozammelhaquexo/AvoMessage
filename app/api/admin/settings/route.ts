import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { created, handle, ok, parseJson } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { getSettings, updateSetting } from "@/lib/services/admin";
import { systemSettingSchema } from "@/lib/validation";
import { queryParam } from "@/lib/route";

export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  return ok(await getSettings(user, queryParam(req, "key") ?? undefined));
});

export const POST = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const input = await parseJson(req, systemSettingSchema);
  return created(await updateSetting(user, input, { ip: auditIp(req) }));
});

// PATCH is the verb the admin settings editor uses (edit an existing key, or
// upsert a new one). `updateSetting` is an upsert, so both verbs share it.
export const PATCH = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const input = await parseJson(req, systemSettingSchema);
  return ok(await updateSetting(user, input, { ip: auditIp(req) }));
});
