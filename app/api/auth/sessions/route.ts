import { NextRequest, NextResponse } from 'next/server';
import { handle, ok } from '@/lib/api';
import {
  listUserSessions,
  revokeOtherSessions,
} from '@/lib/auth/session';
import { auditIp, writeAuditLog } from '@/lib/audit';
import { requireSession } from '@/lib/permissions';

export const GET = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user, session } = await requireSession(req);
  const data = await listUserSessions(user.id, session.id);
  return ok({ data });
});

/** Revoke all sessions except the current one ("log out other devices"). */
export const DELETE = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user, session } = await requireSession(req);
  const revoked = await revokeOtherSessions(user.id, session.id);
  await writeAuditLog({
    actorId: user.id,
    action: 'account.sessions_revoked_others',
    entityType: 'user',
    entityId: user.id,
    metadata: { revoked },
    ipAddress: auditIp(req),
  });
  return ok({ ok: true, revoked });
});
