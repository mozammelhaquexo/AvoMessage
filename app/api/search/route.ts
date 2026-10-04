import { NextRequest, NextResponse } from 'next/server';
import { ValidationError, getPaginationParams, handle, ok } from '@/lib/api';
import { requireSession } from '@/lib/permissions';
import { search, type SearchType } from '@/lib/services/search';
import { searchSchema } from '@/lib/validation';

export const GET = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user } = await requireSession(req);
  const url = new URL(req.url);
  const parsed = searchSchema.safeParse({
    q: url.searchParams.get('q') ?? '',
    type: url.searchParams.get('type') ?? 'users',
  });
  if (!parsed.success) {
    throw new ValidationError('Invalid search parameters', {
      q: ['Query is required'],
    });
  }
  const { limit, cursor } = getPaginationParams(req);
  return ok(await search(parsed.data.q, parsed.data.type as SearchType, user.id, { limit, cursor }));
});
