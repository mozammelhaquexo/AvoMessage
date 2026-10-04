/**
 * Reports service: users report posts/comments/messages/users; reporters can
 * list their own reports. Admin review lives in Backend Engineer B's domain
 * (/api/admin/reports) — this service only files + lists.
 */
import { ReportReason, ReportTarget } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ForbiddenError, NotFoundError, decodeCursor, encodeCursor } from '@/lib/api';
import type { ReportCreateInput } from '@/lib/validation';

async function targetAuthorId(targetType: ReportTarget, targetId: string): Promise<string | null> {
  switch (targetType) {
    case ReportTarget.POST: {
      const p = await prisma.post.findUnique({ where: { id: targetId }, select: { authorId: true } });
      return p?.authorId ?? null;
    }
    case ReportTarget.COMMENT: {
      const c = await prisma.comment.findUnique({ where: { id: targetId }, select: { authorId: true } });
      return c?.authorId ?? null;
    }
    case ReportTarget.MESSAGE: {
      const m = await prisma.message.findUnique({ where: { id: targetId }, select: { senderId: true } });
      return m?.senderId ?? null;
    }
    case ReportTarget.USER: {
      const u = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
      return u?.id ?? null;
    }
  }
}

export async function createReport(reporterId: string, input: ReportCreateInput) {
  const authorId = await targetAuthorId(input.targetType as ReportTarget, input.targetId);
  if (authorId === null) throw new NotFoundError('Reported content not found');
  if (authorId === reporterId) {
    throw new ForbiddenError('CANNOT_REPORT_SELF', 'You cannot report your own content');
  }
  const report = await prisma.report.create({
    data: {
      reporterId,
      targetType: input.targetType as ReportTarget,
      targetId: input.targetId,
      reason: input.reason as ReportReason,
      details: input.details ?? null,
    },
  });
  return {
    id: report.id,
    targetType: report.targetType,
    targetId: report.targetId,
    reason: report.reason,
    status: report.status,
    createdAt: report.createdAt,
  };
}

export async function listOwnReports(
  reporterId: string,
  opts: { limit: number; cursor: string | null },
) {
  const where: Record<string, unknown> = { reporterId };
  if (opts.cursor) {
    const { createdAt, id } = decodeCursor(opts.cursor);
    where.OR = [
      { createdAt: { lt: createdAt } },
      { createdAt: { equals: createdAt }, id: { lt: id } },
    ];
  }
  const rows = await prisma.report.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
  });
  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  return {
    data: page.map((r) => ({
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      reason: r.reason,
      details: r.details,
      status: r.status,
      createdAt: r.createdAt,
    })),
    nextCursor:
      hasMore && page.length > 0
        ? encodeCursor(page[page.length - 1]!.createdAt, page[page.length - 1]!.id)
        : null,
  };
}
