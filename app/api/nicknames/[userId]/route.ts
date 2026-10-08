/**
 * DELETE /api/nicknames/:userId — remove the caller's private name for someone.
 *
 * Deliberately a thin wrapper over `setContactNickname(…, { nickname: null })`
 * rather than a second service function: "clear" and "set" are the same write
 * with a different value, and two implementations would eventually disagree
 * about validation, auditing or the self-rename rule.
 *
 * Idempotent. Deleting a nickname that was never set is a success, because the
 * caller's intent — "this person should not have a private name" — is already
 * true. A 404 would only invite a pointless error toast.
 */
import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { setContactNickname } from "@/lib/services/nicknames";
import { routeParams } from "@/lib/route";

export const DELETE = handle(
  async (req: NextRequest, ctx?: RouteContext<{ userId: string }>) => {
    const { userId } = await routeParams(ctx);
    const { user } = await requireSession(req);
    return ok(
      await setContactNickname(user, { userId, nickname: null }, { ip: auditIp(req) }),
    );
  },
);
