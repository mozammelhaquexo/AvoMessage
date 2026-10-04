import { NextRequest, NextResponse } from 'next/server';
import { handle, ok, parseJson } from '@/lib/api';
import { requireSession } from '@/lib/permissions';
import { getOwnProfile, updateProfile } from '@/lib/services/users';
import { updateProfileSchema } from '@/lib/validation';

export const GET = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user } = await requireSession(req);
  return ok(await getOwnProfile(user));
});

export const PATCH = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user } = await requireSession(req);
  const input = await parseJson(req, updateProfileSchema);
  return ok(await updateProfile(user.id, input));
});
