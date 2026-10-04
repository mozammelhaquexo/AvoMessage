import type { NextRequest } from "next/server";
import { auditIp } from "@/lib/audit";
import { created, handle, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { createMemberAccount } from "@/lib/services/companies";
import { companyAccountCreateSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

/**
 * SUPERSEDED — creates the account immediately and mails a temporary password.
 *
 * The app no longer calls this. Adding a member goes through the OTP route
 * (`./otp`) instead: the details are held on a challenge, a code goes to the
 * member's own address, and the account exists only once that address confirms
 * it. That is the difference that matters — here the manager's typing of
 * somebody else's email is taken at face value, so a typo creates an account
 * nobody can sign into and a deliberately wrong address creates one for a
 * person who never asked.
 *
 * Kept (rather than deleted) only because `tests/api/manager-grant.test.ts`
 * exercises it, and because removing a public endpoint is a bigger call than
 * changing which one the product uses. It is unreachable from the UI.
 */
export const POST = handle(async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
  const { id } = await routeParams(ctx);
  const { user } = await requireSession(req);
  const input = await parseJson(req, companyAccountCreateSchema);
  return created(await createMemberAccount(user, id, input, { ip: auditIp(req) }));
});
