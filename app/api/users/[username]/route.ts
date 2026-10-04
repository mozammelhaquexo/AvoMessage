import { NextRequest, NextResponse } from 'next/server';
import { ForbiddenError, handle, NotFoundError, ok, parseJson, RouteContext } from '@/lib/api';
import { requireSession } from '@/lib/permissions';
import { getProfileByUsername, updateProfile } from '@/lib/services/users';
import { updateProfileSchema, usernameSchema } from '@/lib/validation';

async function getUsername(ctx?: RouteContext<{ username: string }>): Promise<string> {
  const raw = (await ctx?.params)?.username;
  const parsed = usernameSchema.safeParse(raw);
  if (!parsed.success) throw new NotFoundError('User not found');
  return parsed.data;
}

/** Public profile (privacy-aware); viewerState is null when anonymous. */
export const GET = handle(
  async (req: NextRequest, ctx?: RouteContext<{ username: string }>): Promise<NextResponse> => {
    const username = await getUsername(ctx);
    // Optional session: anonymous viewers get the public view.
    let viewerId: string | null = null;
    try {
      viewerId = (await requireSession(req)).user.id;
    } catch {
      viewerId = null;
    }
    return ok(await getProfileByUsername(username, viewerId));
  },
);

/** PATCH is only allowed on your own profile (username must match). */
export const PATCH = handle(
  async (req: NextRequest, ctx?: RouteContext<{ username: string }>): Promise<NextResponse> => {
    const { user } = await requireSession(req);
    const username = await getUsername(ctx);
    if (user.username !== username) {
      throw new ForbiddenError('NOT_PROFILE_OWNER', 'You can only edit your own profile');
    }
    const input = await parseJson(req, updateProfileSchema);
    return ok(await updateProfile(user.id, input));
  },
);
