import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { created, handle, ok, parseJson } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { createPlatformAnnouncement, listPlatformAnnouncements } from "@/lib/services/admin";
import { adminAnnouncementCreateSchema } from "@/lib/validation";

export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  return ok(await listPlatformAnnouncements(user));
});

export const POST = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const input = await parseJson(req, adminAnnouncementCreateSchema);
  return created(await createPlatformAnnouncement(user, input, { ip: auditIp(req) }));
});
