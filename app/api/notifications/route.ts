import { NextRequest, NextResponse } from 'next/server';
import { NotificationType } from '@prisma/client';
import { getPaginationParams, handle, ok } from '@/lib/api';
import { requireSession } from '@/lib/permissions';
import { listNotifications } from '@/lib/services/notifications';

/**
 * `?type=` takes a comma-separated list of NotificationType names (the filter
 * groups in lib/notification-filters.ts join their members with commas).
 * Unknown names are dropped rather than erroring, so a stale bookmark or an
 * older client can never 400 the list.
 *
 * Filtering happens here, not in the browser: the client previously filtered
 * only the rows it had already paged in, so picking "Messages" on a feed whose
 * first page was all likes showed an empty list even when message
 * notifications existed further back.
 */
const KNOWN_TYPES = new Set<string>(Object.values(NotificationType));

export const GET = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user } = await requireSession(req);
  const { limit, cursor } = getPaginationParams(req);
  const params = new URL(req.url).searchParams;
  const unreadOnly = params.get('unreadOnly') === 'true';
  const rawType = params.get('type');
  const types = rawType
    ? (rawType
        .split(',')
        .map((t) => t.trim())
        .filter((t) => KNOWN_TYPES.has(t)) as NotificationType[])
    : undefined;
  return ok(
    await listNotifications(user.id, {
      limit,
      cursor,
      unreadOnly,
      types: types && types.length > 0 ? types : undefined,
    }),
  );
});
