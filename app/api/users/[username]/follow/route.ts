import { NextRequest, NextResponse } from 'next/server';
import { handle, NotFoundError, ok, RouteContext } from '@/lib/api';
import { requireSession, requireVerified } from '@/lib/permissions';
import { followUser, unfollowUser } from '@/lib/services/users';
import { usernameSchema } from '@/lib/validation';

async function getUsername(ctx?: RouteContext<{ username: string }>): Promise<string> {
  const raw = (await ctx?.params)?.username;
  const parsed = usernameSchema.safeParse(raw);
  if (!parsed.success) throw new NotFoundError('User not found');
  return parsed.data;
}

export const POST = handle(
  async (req: NextRequest, ctx?: RouteContext<{ username: string }>): Promise<NextResponse> => {
    const { user } = await requireSession(req);
    requireVerified(user);
    return ok(await followUser(user.id, await getUsername(ctx)), 200);
  },
);

export const DELETE = handle(
  async (req: NextRequest, ctx?: RouteContext<{ username: string }>): Promise<NextResponse> => {
    const { user } = await requireSession(req);
    return ok(await unfollowUser(user.id, await getUsername(ctx)));
  },
);
