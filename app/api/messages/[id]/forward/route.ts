import type { NextRequest } from "next/server";
import { created, handle, ok, parseJson, type RouteContext } from "@/lib/api";
import { requireSession } from "@/lib/permissions";
import { forwardMessage } from "@/lib/services/messages";
import { messageForwardSchema } from "@/lib/validation";
import { routeParams } from "@/lib/route";

/**
 * Forward `[id]` into another conversation.
 *
 * The socket path (`message:send` with `forwardedFromId`) is what the UI uses,
 * because it also fans the message out live. This route exists for non-socket
 * clients and keeps the two paths on the same service, so the read-access
 * check cannot be bypassed by choosing one over the other.
 */
export const POST = handle(
  async (req: NextRequest, ctx?: RouteContext<{ id: string }>) => {
    const { id } = await routeParams(ctx);
    const { user } = await requireSession(req);
    const input = await parseJson(req, messageForwardSchema);
    const { message, created: isNew } = await forwardMessage(
      user,
      id,
      input.conversationId,
      input.note,
    );
    return isNew ? created({ message }) : ok({ message });
  },
);
