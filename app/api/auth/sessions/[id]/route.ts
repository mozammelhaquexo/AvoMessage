import { NextRequest, NextResponse } from 'next/server';
import { ForbiddenError, handle, NotFoundError, ok, RouteContext } from '@/lib/api';
import { revokeSession } from '@/lib/auth/session';
import { auditIp, writeAuditLog } from '@/lib/audit';
import { requireSession } from '@/lib/permissions';

export const DELETE = handle(
  async (req: NextRequest, ctx?: RouteContext<{ id: string }>): Promise<NextResponse> => {
    const { user, session } = await requireSession(req);
    const id = (await ctx?.params)?.id;
    if (!id) throw new NotFoundError('Session not found');
    if (id === session.id) {
      throw new ForbiddenError('CANNOT_REVOKE_CURRENT', 'Use logout to end the current session');
    }
    const revoked = await revokeSession(user.id, id);
    if (!revoked) throw new NotFoundError('Session not found');
    await writeAuditLog({
      actorId: user.id,
      action: 'account.session_revoked',
      entityType: 'session',
      entityId: id,
      ipAddress: auditIp(req),
    });
    return ok({ ok: true });
  },
);
