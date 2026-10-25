// Phase 4 job: Task.isOverdue is a materialized view of (PENDING && dueAt < now)
// (ADR-006). Writes still compute it at create/update time; this job repairs the
// only remaining drift source — time passing with no write — on a schedule
// (ADR-010). Idempotent: safe to re-run, safe to skip a tick.
import { prisma } from '../lib/prisma.js';

export interface OverdueSyncResult {
  marked: number;
  cleared: number;
}

export async function syncOverdueFlags(now: Date = new Date()): Promise<OverdueSyncResult> {
  const [marked, cleared] = await prisma.$transaction([
    // A PENDING task whose due date has passed becomes overdue.
    prisma.task.updateMany({
      where: { status: 'PENDING', dueAt: { lt: now }, isOverdue: false },
      data: { isOverdue: true },
    }),
    // Completed/cancelled or rescheduled tasks lose the flag. Completing an
    // overdue task clears it (the late history lives in updatedAt), but the
    // flag never survives a state that is no longer overdue.
    prisma.task.updateMany({
      where: { isOverdue: true, OR: [{ status: { not: 'PENDING' } }, { dueAt: { gte: now } }] },
      data: { isOverdue: false },
    }),
  ]);
  return { marked: marked.count, cleared: cleared.count };
}
