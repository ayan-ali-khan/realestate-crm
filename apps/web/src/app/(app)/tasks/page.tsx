'use client';

// Task center: my follow-ups (agents see only their own — the API scopes it),
// overdue-first scanning, and manager reassignment. The overdue flag itself is
// maintained by the Phase 4 cron (ADR-010); this page just renders it.
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth, isManager } from '@/lib/auth';
import { TaskStatusBadge } from '@/lib/badges';
import { TASK_STATUSES, type Lead, type Task, type User } from '@/lib/types';

const PAGE_SIZE = 25;

// useSearchParams requires a Suspense boundary for prerendering (Next 16);
// the default export is that boundary, the content does the reading.
export default function TasksPage() {
  return (
    <Suspense fallback={<p className="py-12 text-center text-sm text-zinc-500">Loading tasks…</p>}>
      <TasksContent />
    </Suspense>
  );
}

function TasksContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const manager = isManager(user);

  // Data keyed by its filter URL; loading is derived, never set in an effect.
  const [result, setResult] = useState<{ key: string; tasks: Task[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const status = searchParams.get('status') ?? '';
  const overdue = searchParams.get('overdue') ?? '';
  const page = Number(searchParams.get('page') ?? '1') || 1;

  const setFilter = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      router.replace(`/tasks?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const queryKey = searchParams.toString();
  const loading = result?.key !== queryKey;
  const tasks = result?.key === queryKey ? result.tasks : [];
  const total = result?.key === queryKey ? result.total : 0;

  const reload = useCallback(() => {
    // setState only inside async continuations (react-hooks/set-state-in-effect).
    api.tasks
      .list({
        status: (status || undefined) as Task['status'] | undefined,
        overdue: overdue === 'true' ? true : undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      .then((res) => {
        setResult({ key: queryKey, tasks: res.data, total: res.meta.total });
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, [status, overdue, page, queryKey]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Pickers are only meaningful when creating; fetch lazily on first open.
  useEffect(() => {
    if (!showCreate) return;
    void api.leads
      .list({ pageSize: 50 })
      .then((res) => setLeads(res.data))
      .catch(() => setLeads([]));
    if (manager) {
      void api.users
        .list()
        .then((res) => setUsers(res.data))
        .catch(() => setUsers([]));
    }
  }, [showCreate, manager]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api.tasks.create({
        leadId: String(form.get('leadId')),
        title: String(form.get('title')),
        dueAt: new Date(String(form.get('dueAt'))).toISOString(),
        assigneeId: manager && form.get('assigneeId') ? String(form.get('assigneeId')) : undefined,
      });
      setShowCreate(false);
      reload();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to create task');
    }
  }

  async function setStatus(task: Task, status: Task['status']) {
    try {
      await api.tasks.update(task.id, { status });
      reload();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function reassign(task: Task, assigneeId: string) {
    try {
      await api.tasks.update(task.id, { assigneeId });
      reload();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Reassign failed');
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Tasks</h1>
          <p className="text-sm text-zinc-500">
            {loading ? 'Loading…' : `${total} task${total === 1 ? '' : 's'}`}
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {showCreate ? 'Close' : 'New task'}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={onCreate}
          className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-4"
        >
          <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
            Title *
            <input name="title" required className="input" placeholder="Call back about 2BR" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Lead *
            <select name="leadId" required className="input">
              <option value="" disabled>
                Pick a lead…
              </option>
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Due *
            <input name="dueAt" type="datetime-local" required className="input" />
          </label>
          {manager && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Assign to
              <select name="assigneeId" defaultValue={user?.id ?? ''} className="input">
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex items-end sm:col-span-4">
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Create task
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => setFilter('status', e.target.value)}
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
        >
          <option value="">All statuses</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={overdue}
          onChange={(e) => setFilter('overdue', e.target.value)}
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
        >
          <option value="">All tasks</option>
          <option value="true">Overdue only</option>
        </select>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {/* List */}
      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {loading && <p className="px-4 py-8 text-center text-sm text-zinc-500">Loading…</p>}
        {!loading && tasks.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">No tasks match.</p>
        )}
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {tasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium ${
                    task.status !== 'PENDING' ? 'text-zinc-400 line-through' : ''
                  }`}
                >
                  {task.title}
                </p>
                <p className="text-xs text-zinc-500">
                  <Link href={`/leads/${task.lead.id}`} className="hover:underline">
                    {task.lead.name}
                  </Link>{' '}
                  · due {new Date(task.dueAt).toLocaleString()} · {task.assignee.name}
                </p>
              </div>

              <TaskStatusBadge status={task.status} overdue={task.isOverdue} />

              <div className="flex items-center gap-2">
                {task.status === 'PENDING' ? (
                  <button
                    onClick={() => void setStatus(task, 'DONE')}
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Complete
                  </button>
                ) : (
                  <button
                    onClick={() => void setStatus(task, 'PENDING')}
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Reopen
                  </button>
                )}
                {manager && (
                  <select
                    value={task.assignee.id}
                    onChange={(e) => void reassign(task, e.target.value)}
                    className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700"
                    title="Reassign"
                  >
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                    {/* Current assignee always present even if users failed to load. */}
                    {!users.some((u) => u.id === task.assignee.id) && (
                      <option value={task.assignee.id}>{task.assignee.name}</option>
                    )}
                  </select>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setFilter('page', String(page - 1))}
            className="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
          >
            Previous
          </button>
          <span className="text-zinc-500">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setFilter('page', String(page + 1))}
            className="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
