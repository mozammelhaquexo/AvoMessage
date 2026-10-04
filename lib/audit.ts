/**
 * Audit logging. Every sensitive operation writes an AuditLog row:
 * platform role change, suspend/unsuspend, company role change, member
 * removal, ownership transfer, company deactivation, invitation revoke,
 * system setting change, admin content deletion, report resolution —
 * plus (this agent's domains) account creation, email verification,
 * password change/reset, and session revocations.
 */
import { prisma } from '@/lib/db';
import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { getClientIp } from '@/lib/rate-limit';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (e) {
    // Audit logging must never break the operation it records.
    console.error('[audit] failed to write audit log', e);
  }
}

/** Convenience: build an AuditEntry's ipAddress from the request. */
export function auditIp(req: NextRequest): string | null {
  const ip = getClientIp(req);
  return ip === 'unknown' ? null : ip;
}
