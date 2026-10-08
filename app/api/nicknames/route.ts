/**
 * /api/nicknames — the caller's PRIVATE names for other people.
 *
 *   GET  → every contact nickname the caller has set
 *   PUT  → set or clear one (`nickname: null` clears it)
 *
 * These are private labels, so the whole surface is scoped to the caller:
 * there is no route to read or write somebody else's contact nicknames, and
 * `setContactNickname` refuses a self-rename. Clearing goes through the same
 * service call as setting (with `nickname: null`) so the two can never drift.
 */
import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, paginated, parseJson } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { listContactNicknames, setContactNickname } from "@/lib/services/nicknames";
import { contactNicknameSchema } from "@/lib/validation";

export const GET = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  // The canonical list shape, even though this list is never paged: it is
  // small, bounded by how many people one user has renamed, and returning
  // `{ data }` means the client has one shape to handle rather than two.
  return ok(paginated(await listContactNicknames(user), null));
});

export const PUT = handle(async (req: NextRequest) => {
  const { user } = await requireSession(req);
  const input = await parseJson(req, contactNicknameSchema);
  return ok(await setContactNickname(user, input, { ip: auditIp(req) }));
});
