import { NextRequest, NextResponse } from 'next/server';
import { getPaginationParams, handle, NotFoundError, ok, RouteContext } from '@/lib/api';
import { requireSession } from '@/lib/permissions';
import { listFollowers } from '@/lib/services/users';
import { usernameSchema } from '@/lib/validation';

async function getUsername(ctx?: RouteContext<{ username: string }>): Promise<string> {
  const raw = (await ctx?.params)?.username;
  const parsed = usernameSchema.safeParse(raw);
  if (!parsed.success) throw new NotFoundError('User not found');
  return parsed.data;
}

async function getViewerId(req: NextRequest): Promise<string | null> {
  try {
    return (await requireSession(req)).user.id;
  } catch {
    return null;
  }
}

export const GET = handle(
  async (req: NextRequest, ctx?: RouteContext<{ username: string }>): Promise<NextResponse> => {
    const { limit, cursor } = getPaginationParams(req);
    return ok(await listFollowers(await getUsername(ctx), await getViewerId(req), { limit, cursor }));
  },
);
