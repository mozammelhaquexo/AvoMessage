import { NextRequest, NextResponse } from 'next/server';
import { handle, NotFoundError, ok, RouteContext } from '@/lib/api';
import { requireSession } from '@/lib/permissions';
import { blockUser, unblockUser } from '@/lib/services/users';
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
    return ok(await blockUser(user.id, await getUsername(ctx)));
  },
);

export const DELETE = handle(
  async (req: NextRequest, ctx?: RouteContext<{ username: string }>): Promise<NextResponse> => {
    const { user } = await requireSession(req);
    return ok(await unblockUser(user.id, await getUsername(ctx)));
  },
);
