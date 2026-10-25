// Phase 4: background jobs — overdue-flag sync, refresh-token pruning, and the
// scheduler lifecycle (validation, enable/disable, stop). Runs against the same
// isolated *_test database as the rest of the suite; jobs are invoked directly
// rather than waiting on wall-clock cron ticks.
import { describe, expect, it, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma.js';
import { syncOverdueFlags } from '../src/jobs/overdue.sync.js';
import { pruneExpiredRefreshTokens } from '../src/jobs/token-prune.js';
import { startJobs } from '../src/jobs/scheduler.js';
import { hashToken } from '../src/lib/tokens.js';
import type { Task } from '../src/generated/prisma/client.js';

const TAG = `p4job-${Date.now().toString(36)}`;

// Direct DB fixtures: jobs are infrastructure, not API surface — the HTTP
// layer is already covered by the tasks suite.
async function makeTask(overrides: {
  dueAt: Date;
  status?: 'PENDING' | 'DONE';
  isOverdue?: boolean;
}): Promise<Task> {
  const user = await prisma.user.findUnique({ where: { email: 'agent@crm.test' } });
  if (!user) throw new Error('seed user agent@crm.test missing');
  const lead = await prisma.lead.create({
    data: { name: `${TAG} lead-${randomUUID().slice(0, 8)}`, phone: '+15550009', source: 'OTHER' },
  });
  return prisma.task.create({
    data: {
      leadId: lead.id,
      assigneeId: user.id,
      title: `${TAG} task`,
      dueAt: overrides.dueAt,
      status: overrides.status ?? 'PENDING',
      isOverdue: overrides.isOverdue ?? false,
    },
  });
}

describe('overdue-sync job', () => {
  it('marks a pending past-due task that drifted (no write happened)', async () => {
    // dueAt in the past, flag still false — exactly the drift the cron repairs.
    const task = await makeTask({ dueAt: new Date(Date.now() - 3_600_000) });
    expect(task.isOverdue).toBe(false);

    const result = await syncOverdueFlags();
    expect(result.marked).toBeGreaterThanOrEqual(1);

    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.isOverdue).toBe(true);
  });

  it('clears the flag on a completed task and on a rescheduled future task', async () => {
    const done = await makeTask({
      dueAt: new Date(Date.now() - 3_600_000),
      status: 'DONE',
      isOverdue: true,
    });
    const moved = await makeTask({ dueAt: new Date(Date.now() - 3_600_000), isOverdue: true });
    await prisma.task.update({
      where: { id: moved.id },
      data: { dueAt: new Date(Date.now() + 86_400_000) },
    });

    await syncOverdueFlags();

    const doneAfter = await prisma.task.findUniqueOrThrow({ where: { id: done.id } });
    expect(doneAfter.isOverdue).toBe(false);
    const movedAfter = await prisma.task.findUniqueOrThrow({ where: { id: moved.id } });
    expect(movedAfter.isOverdue).toBe(false);
  });

  it('is idempotent: a second run changes nothing', async () => {
    await syncOverdueFlags();
    const second = await syncOverdueFlags();
    expect(second.marked).toBe(0);
    expect(second.cleared).toBe(0);
  });
});

describe('token-prune job', () => {
  const inserted: string[] = [];

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { id: { in: inserted } } });
  });

  it('deletes expired rows and keeps live ones (revocation window intact)', async () => {
    const user = await prisma.user.findUnique({ where: { email: 'agent@crm.test' } });
    if (!user) throw new Error('seed user agent@crm.test missing');

    const expired = await prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(randomUUID()),
        userId: user.id,
        expiresAt: new Date(Date.now() - 86_400_000),
      },
    });
    inserted.push(expired.id);
    const revokedButLive = await prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(randomUUID()),
        userId: user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: new Date(),
      },
    });
    inserted.push(revokedButLive.id);
    const live = await prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(randomUUID()),
        userId: user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    inserted.push(live.id);

    const result = await pruneExpiredRefreshTokens();
    expect(result.deleted).toBeGreaterThanOrEqual(1);

    expect(await prisma.refreshToken.findUnique({ where: { id: expired.id } })).toBeNull();
    // Revoked-but-unexpired must survive: it is the replay-detection signal.
    expect(
      await prisma.refreshToken.findUnique({ where: { id: revokedButLive.id } }),
    ).not.toBeNull();
    expect(await prisma.refreshToken.findUnique({ where: { id: live.id } })).not.toBeNull();
  });
});

describe('scheduler', () => {
  it('starts with valid expressions and stop() silences it', async () => {
    const jobs = startJobs({
      enabled: true,
      config: { overdueSync: '0 0 1 1 *', tokenPrune: '0 0 1 1 *' }, // yearly: never fires mid-test
    });
    const handle = jobs as unknown as { stop: () => Promise<void> };
    await expect(handle.stop()).resolves.toBeUndefined();
  });

  it('rejects an invalid cron expression at startup (fail fast)', () => {
    expect(() =>
      startJobs({ enabled: true, config: { overdueSync: 'not a cron', tokenPrune: '0 0 * * *' } }),
    ).toThrow(/Invalid cron expression/);
  });

  it('is a no-op when disabled', async () => {
    const jobs = startJobs({ enabled: false });
    await expect(jobs.stop()).resolves.toBeUndefined();
  });
});
