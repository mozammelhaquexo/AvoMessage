import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { setCompanyMemberRole } from "@/lib/services/admin";
import { adminCompanyMemberRoleSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

/**
 * Admin-only: make someone a manager of this company, or take the role back.
 *
 * This is the ONLY endpoint that can grant the MANAGER company role (part 2,
 * request 3). It lives under /api/admin so the platform guard applies before the
 * service is reached, and the service asserts admin again — the company-facing
 * member endpoints accept MEMBER and nothing else.
 *
 * `role` is validated against `companyRoleSchema` (MANAGER | MEMBER), so
 * `role: "OWNER"` is a 400 here just as it is everywhere else.
 */
export const PATCH = handle(
  async (
    req: NextRequest,
    ctx?: RouteContext<{ companyId: string; userId: string }>
  ) => {
    const { companyId, userId } = await routeParams(ctx);
    const { user } = await requireSession(req);
    const input = await parseJson(req, adminCompanyMemberRoleSchema);
    return ok(
      await setCompanyMemberRole(user, companyId, userId, input.role, { ip: auditIp(req) })
    );
  }
);
