import type { NextRequest, NextResponse } from 'next/server';
import { handle, ok, parseJson } from '@/lib/api';
import { requireSession } from '@/lib/permissions';
import { deleteSubscription, saveSubscription } from '@/lib/services/push';
import { pushSubscribeSchema, pushUnsubscribeSchema } from '@/lib/validation';

/**
 * POST /api/push/subscribe — remember this browser's push endpoint.
 *
 * CSRF IS NOT OPTIONAL HERE. The request is cookie-authenticated, and without
 * the double-submit check a hostile page could POST its own endpoint and keys
 * while the victim is signed in — which would route the victim's message
 * notifications, sender names and previews to the attacker's server. The
 * service worker, which cannot read the `avo_csrf` cookie, gets its token from
 * a same-origin Cache entry written by the page; see `lib/push-client.ts`.
 */
export const POST = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user } = await requireSession(req);
  const input = await parseJson(req, pushSubscribeSchema);
  const result = await saveSubscription(user.id, {
    endpoint: input.endpoint,
    keys: input.keys,
    userAgent: req.headers.get('user-agent'),
  });
  return ok({ ok: true as const, id: result.id });
});

/**
 * DELETE /api/push/subscribe — forget one endpoint.
 *
 * Scoped to the caller in the service layer, so a user cannot silence another
 * user's device by naming its endpoint.
 */
export const DELETE = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user } = await requireSession(req);
  const input = await parseJson(req, pushUnsubscribeSchema);
  const { removed } = await deleteSubscription(user.id, input.endpoint);
  return ok({ ok: true as const, removed });
});
