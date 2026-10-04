import type { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { usernameSchema } from "@/lib/validation";
import { queryParam } from "@/lib/route";
import type { UsernameAvailability } from "@/lib/api-types";

/**
 * Public username availability check, used by the sign-up form's debounced
 * lookup.
 *
 * Deliberately public (sign-up happens before a session exists) and therefore
 * deliberately uninformative: it returns only "taken / not taken" for a name
 * that already passed the format rules. It never reveals an email, an id, or
 * anything else about the existing account.
 *
 * The `read` rate-limit preset is used rather than `auth`: this is a read, it
 * fires on every debounce, and the `auth` bucket (10/min) is shared with the
 * actual sign-up POST.
 */
export const GET = handle(
  async (req: NextRequest) => {
    const raw = (queryParam(req, "username") ?? "").trim();
    const parsed = usernameSchema.safeParse(raw);

    if (!parsed.success) {
      return ok<UsernameAvailability>({
        username: raw,
        available: false,
        reason: parsed.error.issues[0]?.message ?? "That username isn't valid.",
      });
    }

    const existing = await prisma.user.findUnique({
      where: { username: parsed.data },
      select: { id: true },
    });

    return ok<UsernameAvailability>({
      username: parsed.data,
      available: !existing,
      reason: existing ? "That username is already taken." : null,
    });
  },
  { csrf: false, rateLimit: "read" },
);
