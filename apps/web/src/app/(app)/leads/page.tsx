'use client';

// Leads pipeline list. Filters live in the URL (shareable, back-button
// friendly) and are passed straight to the API — the server owns filtering,
// the UI just renders what comes back. Agents automatically see only their
// own leads (the API scopes them; no client-side guessing).
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth, isManager } from '@/lib/auth';
import { PriorityBadge, StageBadge } from '@/lib/badges';
import {
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  PIPELINE_STAGES,
  type Lead,
  type Paginated,
} from '@/lib/types';

const PAGE_SIZE = 20;

// URL params are plain strings; narrow to the enum unions (invalid values from
// a hand-edited URL become "no filter" rather than a 400 from the API).
function narrow<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

function money(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

// useSearchParams requires a Suspense boundary for prerendering (Next 16);
// the default export is that boundary, the content does the reading.
export default function LeadsPage() {
  return (
    <Suspense fallback={<p className="py-12 text-center text-sm text-zinc-500">Loading leads…</p>}>
      <LeadsContent />
    </Suspense>
  );
}

function LeadsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  // Data + the filter key it was loaded for; "loading" is derived from the
  // mismatch, so effects never set state synchronously.
  const [result, setResult] = useState<{ key: string; page: Paginated<Lead> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const filters = {
    q: searchParams.get('q') ?? undefined,
    stage: narrow(searchParams.get('stage'), PIPELINE_STAGES),
    priority: narrow(searchParams.get('priority'), LEAD_PRIORITIES),
    source: narrow(searchParams.get('source'), LEAD_SOURCES),
    converted: (() => {
      const v = searchParams.get('converted');
      return v === 'true' ? true : v === 'false' ? false : undefined;
    })(),
    page: Number(searchParams.get('page') ?? '1') || 1,
  };

  const setFilter = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page'); // filter change resets paging
      router.replace(`/leads?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const queryKey = searchParams.toString();
  const loading = result?.key !== queryKey;
  const leads = result?.key === queryKey ? result.page : null;

  useEffect(() => {
    // All setState happens in async continuations (react-hooks/set-state-in-effect).
    let cancelled = false;
    api.leads
      .list({ ...filters, pageSize: PAGE_SIZE })
      .then((page) => {
        if (!cancelled) {
          setResult({ key: queryKey, page });
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load leads');
      });
    return () => {
      cancelled = true;
    };
    // `filters` is rebuilt from searchParams each render; re-running on URL
    // changes is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const lead = await api.leads.create({
        name: String(form.get('name')),
        email: String(form.get('email') ?? '') || undefined,
        phone: String(form.get('phone') ?? '') || undefined,
        source: String(form.get('source')) as Lead['source'],
        priority: String(form.get('priority')) as Lead['priority'],
        budgetMin: form.get('budgetMin') ? Number(form.get('budgetMin')) : undefined,
        budgetMax: form.get('budgetMax') ? Number(form.get('budgetMax')) : undefined,
        preferredLocation: String(form.get('preferredLocation') ?? '') || undefined,
      });
      setShowCreate(false);
      router.push(`/leads/${lead.id}`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to create lead');
    }
  }

  const total = leads?.meta.total ?? 0;
  const totalPages = leads?.meta.totalPages ?? 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-zinc-500">
            {loading ? 'Loading…' : `${total} lead${total === 1 ? '' : 's'}`}
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {showCreate ? 'Close' : 'New lead'}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={onCreate}
          className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-3"
        >
          <label className="flex flex-col gap-1 text-sm font-medium">
            Name *
            <input name="name" required className="input" placeholder="Jane Buyer" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Email
            <input name="email" type="email" className="input" placeholder="jane@example.com" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Phone
            <input name="phone" className="input" placeholder="+1 555 0100" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Source *
            <select name="source" defaultValue="WEBSITE" className="input">
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Priority
            <select name="priority" defaultValue="MEDIUM" className="input">
              {LEAD_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Preferred location
            <input name="preferredLocation" className="input" placeholder="Downtown" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Budget min
            <input name="budgetMin" type="number" min="0" className="input" placeholder="100000" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Budget max
            <input name="budgetMax" type="number" min="0" className="input" placeholder="250000" />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Create lead
            </button>
          </div>
          <p className="col-span-full text-xs text-zinc-500">
            At least one of email or phone is required. New leads start in <strong>NEW_LEAD</strong>
            .
          </p>
        </form>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          defaultValue={filters.q ?? ''}
          onBlur={(e) => setFilter('q', e.target.value.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setFilter('q', e.currentTarget.value.trim());
          }}
          placeholder="Search name, email, phone…"
          className="w-56 rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <select
          value={filters.stage ?? ''}
          onChange={(e) => setFilter('stage', e.target.value)}
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
        >
          <option value="">All stages</option>
          {PIPELINE_STAGES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select
          value={filters.priority ?? ''}
          onChange={(e) => setFilter('priority', e.target.value)}
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
        >
          <option value="">All priorities</option>
          {LEAD_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={filters.source ?? ''}
          onChange={(e) => setFilter('source', e.target.value)}
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
        >
          <option value="">All sources</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        {isManager(user) && (
          <select
            value={filters.converted === undefined ? '' : String(filters.converted)}
            onChange={(e) => setFilter('converted', e.target.value)}
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
          >
            <option value="">All leads</option>
            <option value="true">Converted only</option>
            <option value="false">Not converted</option>
          </select>
        )}
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Stage</th>
              <th className="px-4 py-3 font-medium">Priority</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Budget</th>
              <th className="px-4 py-3 font-medium">Assignee</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                  Loading leads…
                </td>
              </tr>
            )}
            {!loading && leads?.data.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                  No leads match these filters.
                </td>
              </tr>
            )}
            {!loading &&
              leads?.data.map((lead) => (
                <tr
                  key={lead.id}
                  className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
                    >
                      {lead.name}
                    </Link>
                    <div className="text-xs text-zinc-500">{lead.email ?? lead.phone ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StageBadge stage={lead.stage} />
                    {lead.convertedToCustomer && (
                      <span className="ml-1 text-xs text-emerald-600">★ customer</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <PriorityBadge priority={lead.priority} />
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {lead.source.replace(/_/g, ' ')}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {money(lead.budgetMin)} – {money(lead.budgetMax)}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {lead.assignedTo?.name ?? <span className="text-zinc-400">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">
                    {new Date(lead.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button
            disabled={filters.page <= 1}
            onClick={() => setFilter('page', String(filters.page - 1))}
            className="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
          >
            Previous
          </button>
          <span className="text-zinc-500">
            Page {filters.page} of {totalPages}
          </span>
          <button
            disabled={filters.page >= totalPages}
            onClick={() => setFilter('page', String(filters.page + 1))}
            className="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
