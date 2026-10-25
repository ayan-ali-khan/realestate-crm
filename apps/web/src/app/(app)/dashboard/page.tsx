'use client';

// Overview: one screen, summed from exactly what the signed-in user may see —
// agents get their own leads/tasks because every list endpoint scopes by
// assignment (ADR-007), so the dashboard never re-implements permissions.
// Stage counts use six pageSize=1 calls (count via meta.total) rather than
// pulling the whole pipeline into the browser.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { StageBadge } from '@/lib/badges';
import { PIPELINE_STAGES, type Lead, type Paginated, type PipelineStage, type Task } from '@/lib/types';

interface Snapshot {
  stageCounts: Record<PipelineStage, number>;
  totalLeads: number;
  overdueTasks: number;
  pendingTasks: number;
  recentLeads: Lead[];
  upcomingTasks: Task[];
}

export default function DashboardPage() {
  // undefined → loading, null → failed to load.
  const [snapshot, setSnapshot] = useState<Snapshot | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      ...PIPELINE_STAGES.map((stage) => api.leads.list({ stage, pageSize: 1 })),
      api.leads.list({ pageSize: 1 }),
      api.tasks.list({ overdue: true, pageSize: 1 }),
      api.tasks.list({ status: 'PENDING', pageSize: 1 }),
      api.leads.list({ pageSize: 5 }),
      api.tasks.list({ status: 'PENDING', pageSize: 5 }),
    ])
      .then((results) => {
        if (cancelled) return;
        const stagePages = results.slice(0, PIPELINE_STAGES.length) as Paginated<Lead>[];
        const [totalPage, overduePage, pendingPage, recentPage, upcomingPage] = results.slice(
          PIPELINE_STAGES.length,
        ) as [Paginated<Lead>, Paginated<Lead>, Paginated<Task>, Paginated<Lead>, Paginated<Task>];

        setSnapshot({
          stageCounts: Object.fromEntries(
            PIPELINE_STAGES.map((stage, i) => [stage, stagePages[i]?.meta.total ?? 0]),
          ) as Record<PipelineStage, number>,
          totalLeads: totalPage.meta.total,
          overdueTasks: overduePage.meta.total,
          pendingTasks: pendingPage.meta.total,
          recentLeads: recentPage.data,
          upcomingTasks: upcomingPage.data,
        });
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSnapshot(null);
          setError(err instanceof ApiError ? err.message : 'Failed to load dashboard');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (snapshot === undefined) {
    return <p className="py-12 text-center text-sm text-zinc-500">Loading overview…</p>;
  }
  if (snapshot === null) {
    return (
      <p className="py-12 text-center text-sm text-red-600">{error ?? 'Failed to load dashboard'}</p>
    );
  }

  const stageTotal = Math.max(
    1,
    PIPELINE_STAGES.reduce((sum, stage) => sum + snapshot.stageCounts[stage], 0),
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-zinc-500">
          Your pipeline and workload at a glance — filtered to what you can see.
        </p>
      </div>

      {/* Headline numbers */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Leads in pipeline" value={snapshot.totalLeads} />
        <StatCard label="Open tasks" value={snapshot.pendingTasks} />
        <StatCard
          label="Overdue tasks"
          value={snapshot.overdueTasks}
          tone={snapshot.overdueTasks > 0 ? 'danger' : 'plain'}
        />
      </div>

      {/* Pipeline distribution */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Pipeline by stage</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {PIPELINE_STAGES.map((stage) => {
            const count = snapshot.stageCounts[stage];
            return (
              <li key={stage} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-xs text-zinc-500">
                  {stage.replace(/_/g, ' ')}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <span
                    className="block h-full rounded-full bg-zinc-900 dark:bg-zinc-100"
                    style={{ width: `${Math.round((count / stageTotal) * 100)}%` }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                  {count}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent leads */}
        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Newest leads</h2>
            <Link href="/leads" className="text-xs text-zinc-500 hover:underline">
              View all →
            </Link>
          </div>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {snapshot.recentLeads.length === 0 && (
              <li className="text-zinc-500">No leads yet.</li>
            )}
            {snapshot.recentLeads.map((lead) => (
              <li key={lead.id} className="flex items-center justify-between gap-2">
                <div>
                  <Link
                    href={`/leads/${lead.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {lead.name}
                  </Link>
                  <p className="text-xs text-zinc-500">
                    {lead.source.replace(/_/g, ' ')} · {new Date(lead.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <StageBadge stage={lead.stage} />
              </li>
            ))}
          </ul>
        </section>

        {/* Upcoming tasks */}
        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Next tasks due</h2>
            <Link href="/tasks" className="text-xs text-zinc-500 hover:underline">
              View all →
            </Link>
          </div>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {snapshot.upcomingTasks.length === 0 && <li className="text-zinc-500">No open tasks.</li>}
            {snapshot.upcomingTasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-2">
                <div>
                  <Link
                    href={`/leads/${task.lead.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {task.title}
                  </Link>
                  <p className="text-xs text-zinc-500">
                    {task.lead.name} · due {new Date(task.dueAt).toLocaleDateString()}
                  </p>
                </div>
                {task.isOverdue && (
                  <span className="shrink-0 text-xs font-medium text-red-600">overdue</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: number;
  tone?: 'plain' | 'danger';
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === 'danger' ? 'text-red-600 dark:text-red-400' : ''
        }`}
      >
        {value}
      </p>
    </div>
  );
}
