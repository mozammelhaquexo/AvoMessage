import { NextRequest, NextResponse } from 'next/server';
import { getPaginationParams, handle, ok } from '@/lib/api';
import { requireSession } from '@/lib/permissions';
import { getLoginActivity } from '@/lib/services/auth';

export const GET = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user } = await requireSession(req);
  const { limit, cursor } = getPaginationParams(req);
  const result = await getLoginActivity(user.id, { limit, cursor });
  return ok(result);
});
