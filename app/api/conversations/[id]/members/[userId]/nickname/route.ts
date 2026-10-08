/**
 * PUT /api/conversations/:id/members/:userId/nickname
 *
 * Set or clear a member's OWN name inside a group. `nickname: null` clears it.
 *
 * WHY `:userId` IS IN THE PATH AND STILL CHECKED
 * A nickname is a property OF a member, so addressing it through the member is
 * the honest shape — and it means a future "admins may rename members" rule
 * has somewhere to live. But today nobody may rename anybody else, so the id
 * must be the caller's own. The comparison happens HERE, next to the route it
 * protects, rather than inside the service: an authorization check belongs
 * where a reader is looking for it, and keeping it out of the service means no
 * other caller can accidentally invoke it with a foreign id.
 *
 * Groups only, enforced by the service — see `setMemberNickname`.
 */
import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { ForbiddenError, handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { setMemberNickname } from "@/lib/services/nicknames";
import { memberNicknameSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

export const PUT = handle(
  async (req: NextRequest, ctx?: RouteContext<{ id: string; userId: string }>) => {
    const { id, userId } = await routeParams(ctx);
    const { user } = await requireSession(req);

    if (userId !== user.id) {
      throw new ForbiddenError("FORBIDDEN", "You can only change your own nickname");
    }

    const input = await parseJson(req, memberNicknameSchema);
    return ok(await setMemberNickname(user, id, input, { ip: auditIp(req) }));
  },
);
