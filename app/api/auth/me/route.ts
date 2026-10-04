import { NextRequest, NextResponse } from 'next/server';
import { handle, ok } from '@/lib/api';
import { requireSession } from '@/lib/permissions';
import { toPublicUser } from '@/lib/services/auth';

export const GET = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user, session } = await requireSession(req);
  return ok({
    user: toPublicUser(user),
    session: { id: session.id, createdAt: session.createdAt, lastActiveAt: session.lastActiveAt },
  });
});
