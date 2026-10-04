import { NextRequest, NextResponse } from 'next/server';
import { created, getPaginationParams, handle, ok, parseJson } from '@/lib/api';
import { requireSession, requireVerified } from '@/lib/permissions';
import { createReport, listOwnReports } from '@/lib/services/reports';
import { reportCreateSchema } from '@/lib/validation';

export const GET = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user } = await requireSession(req);
  const { limit, cursor } = getPaginationParams(req);
  return ok(await listOwnReports(user.id, { limit, cursor }));
});

export const POST = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user } = await requireSession(req);
  requireVerified(user);
  const input = await parseJson(req, reportCreateSchema);
  return created(await createReport(user.id, input));
});
