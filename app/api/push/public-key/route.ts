import type { NextRequest, NextResponse } from 'next/server';
import { handle, ok } from '@/lib/api';
import { getPublicKey } from '@/lib/services/push';

/**
 * GET /api/push/public-key
 *
 * The VAPID public key the browser needs for `pushManager.subscribe()`. It is
 * public by design — it is sent to every client — so this route deliberately
 * does NOT require a session.
 *
 * That matters for one caller: the service worker's `pushsubscriptionchange`
 * handler, which runs with no page open. Requiring a session there would make
 * the route fail exactly when it is needed most.
 */
export const GET = handle(async (_req: NextRequest): Promise<NextResponse> => {
  return ok({ publicKey: await getPublicKey() });
}, { rateLimit: 'read' });
