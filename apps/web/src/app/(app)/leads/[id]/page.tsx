'use client';

// Lead detail: the pipeline workbench. Stage moves are rendered from
// `allowedTransitions` (the API's stage machine is the single source of truth,
// ADR-009/010) — the UI never re-implements the transition table. Assignment
// and deletion are manager/admin-only and hidden (not just disabled) for
// agents; the API enforces regardless.
import { Suspense, useCallback, use, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth, isManager } from '@/lib/auth';
import { PriorityBadge, StageBadge } from '@/lib/badges';
import {
  ACTIVITY_TYPES,
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  PIPELINE_STAGES,
  type Activity,
  type AiEmailDraft,
  type AiTaskSuggestion,
  type LeadDetail as LeadDetailDto,
  type Paginated,
  type Property,
  type Task,
  type User,
} from '@/lib/types';

function money(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

const STAGE_LABEL: Record<string, string> = Object.fromEntries(
  PIPELINE_STAGES.map((s) => [s, s.replace(/_/g, ' ')]),
);

// Module scope (not component scope) so the react-hooks/purity rule stays
// happy: an accepted AI suggestion becomes a task due `days` out.
function dueDateIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

// Next 16: client pages receive `params` as a Promise and unwrap it with
// `use()`; `useParams()` inside a prerendered client page trips
// CLIENT_HOOK_DYNAMIC at build time.
export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<p className="py-12 text-center text-sm text-zinc-500">Loading…</p>}>
      <LeadDetailContent id={id} />
    </Suspense>
  );
}

function LeadDetailContent({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useAuth();

  // detail === undefined → still loading; null → failed to load. No setState
  // runs synchronously inside effects (react-hooks/set-state-in-effect).
  const [detail, setDetail] = useState<LeadDetailDto | null | undefined>(undefined);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyQuery, setPropertyQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stageNote, setStageNote] = useState('');

  // AI assist panel state. Results are transient (the durable record is the
  // AI_ACTION activity + the lead's stored score, both reloaded below).
  const [aiNote, setAiNote] = useState('');
  const [aiDraft, setAiDraft] = useState<AiEmailDraft | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AiTaskSuggestion[]>([]);
  const [accepting, setAccepting] = useState<string | null>(null);
  // Bumped after an accepted suggestion so LeadTasks refetches.
  const [tasksVersion, setTasksVersion] = useState(0);

  const manager = isManager(user);

  // Fetch + apply as separate steps: the effect below re-runs the fetch with
  // its own cancellation, while `reload` (event handlers only) reuses apply.
  const applyDetail = useCallback((lead: LeadDetailDto, acts: Paginated<Activity>) => {
    setDetail(lead);
    setActivities(acts.data);
    setError(null);
  }, []);

  const fetchPair = useCallback(
    () => Promise.all([api.leads.get(id), api.leads.activities(id)]),
    [id],
  );

  // Called from mutation handlers (never from an effect), so setState-in-async
  // callbacks here is fine.
  const reload = useCallback(
    () =>
      fetchPair()
        .then(([lead, acts]) => applyDetail(lead, acts))
        .catch((err: unknown) => {
          setDetail(null);
          setError(err instanceof ApiError ? err.message : 'Failed to load lead');
        }),
    [fetchPair, applyDetail],
  );

  useEffect(() => {
    // Initial load: .then callbacks keep setState out of the synchronous
    // effect pass (react-hooks/set-state-in-effect).
    let cancelled = false;
    fetchPair()
      .then(([lead, acts]) => {
        if (!cancelled) applyDetail(lead, acts);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDetail(null);
          setError(err instanceof ApiError ? err.message : 'Failed to load lead');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPair, applyDetail]);

  // Manager-only payloads: skip the fetch entirely for agents (the API would
  // 403 the users list anyway).
  useEffect(() => {
    if (!manager) return;
    void api.users
      .list()
      .then((page) => setUsers(page.data))
      .catch(() => setUsers([]));
  }, [manager]);

  // Property catalog for the inquiry picker, searched on demand.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void api.properties
        .list({ q: propertyQuery || undefined })
        .then((page) => {
          if (!cancelled) setProperties(page.data);
        })
        .catch(() => {
          if (!cancelled) setProperties([]);
        });
    }, 250); // debounce typing
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [propertyQuery]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await reload();
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function onEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(() =>
      api.leads.update(id, {
        name: String(form.get('name')),
        email: String(form.get('email') ?? '') || undefined,
        phone: String(form.get('phone') ?? '') || undefined,
        source: String(form.get('source')) as LeadDetailDto['source'],
        priority: String(form.get('priority')) as LeadDetailDto['priority'],
        budgetMin: form.get('budgetMin') ? Number(form.get('budgetMin')) : undefined,
        budgetMax: form.get('budgetMax') ? Number(form.get('budgetMax')) : undefined,
        preferredLocation: String(form.get('preferredLocation') ?? '') || undefined,
      }),
    );
  }

  async function onLogActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget; // capture before await (synthetic events don't persist)
    const form = new FormData(formEl);
    const content = String(form.get('content')).trim();
    if (!content) return;
    await run(() => api.leads.logActivity(id, String(form.get('type')), content));
    formEl.reset();
  }

  // One wrapper for all AI actions: apply the transient result, then reload
  // so the AI_ACTION activity the API logged shows up in the timeline and a
  // re-score updates the header chip.
  async function aiAction<T>(action: () => Promise<T>, apply: (result: T) => void) {
    setBusy(true);
    try {
      apply(await action());
      setError(null);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'AI action failed');
    } finally {
      setBusy(false);
    }
  }

  // Accepting a suggestion is a real task creation via the normal endpoint —
  // the AI never writes tasks itself.
  async function acceptSuggestion(suggestion: AiTaskSuggestion) {
    setAccepting(suggestion.title);
    try {
      const dueAt = dueDateIn(suggestion.dueInDays);
      await api.tasks.create({ leadId: id, title: suggestion.title, dueAt });
      setAiSuggestions((list) => list.filter((s) => s.title !== suggestion.title));
      setTasksVersion((v) => v + 1);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create task');
    } finally {
      setAccepting(null);
    }
  }

  // Schedule a site visit against a property from the shared catalog search.
  async function onScheduleVisit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget; // capture before await
    const form = new FormData(formEl);
    const propertyId = String(form.get('propertyId'));
    const scheduledAt = String(form.get('scheduledAt'));
    if (!propertyId || !scheduledAt) return;
    await run(() => api.leads.scheduleVisit(id, propertyId, scheduledAt));
    formEl.reset();
  }

  if (detail === undefined) {
    return <p className="py-12 text-center text-sm text-zinc-500">Loading lead…</p>;
  }
  if (detail === null) {
    return <p className="py-12 text-center text-sm text-red-600">{error ?? 'Lead not found'}</p>;
  }
  const lead = detail;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/leads" className="text-sm text-zinc-500 hover:underline">
            ← Back to leads
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-xl font-semibold tracking-tight">
            {lead.name}
            <StageBadge stage={lead.stage} />
            <PriorityBadge priority={lead.priority} />
            {lead.aiScore !== null && (
              <span
                title={lead.aiScoreReason ?? 'AI lead score'}
                className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
              >
                AI {lead.aiScore}
              </span>
            )}
            {lead.convertedToCustomer && (
              <span className="text-sm font-medium text-emerald-600">★ customer</span>
            )}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {lead.email ?? 'no email'} · {lead.phone ?? 'no phone'} ·{' '}
            {lead.source.replace(/_/g, ' ')}
            {' · '}budget {money(lead.budgetMin)} – {money(lead.budgetMax)}
            {lead.preferredLocation && ` · prefers ${lead.preferredLocation}`}
          </p>
        </div>
        {manager && (
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.leads.remove(id);
                router.push('/leads');
              })
            }
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          >
            Delete lead
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column: stage actions + details form */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Stage machine */}
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold">Pipeline</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Current stage: <strong>{STAGE_LABEL[lead.stage]}</strong>
              {lead.allowedTransitions.length > 0
                ? ` → can move to ${lead.allowedTransitions.map((s) => STAGE_LABEL[s]).join(', ')}`
                : ' (terminal — no further moves)'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {lead.allowedTransitions.map((stage) => (
                <button
                  key={stage}
                  disabled={busy}
                  onClick={() =>
                    void run(() => api.leads.changeStage(id, stage, stageNote || undefined)).then(
                      () => setStageNote(''),
                    )
                  }
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Move to {STAGE_LABEL[stage]}
                </button>
              ))}
              {lead.allowedTransitions.length === 0 && (
                <span className="text-sm text-zinc-500">
                  This lead is closed; no transitions remain.
                </span>
              )}
              <input
                value={stageNote}
                onChange={(e) => setStageNote(e.target.value)}
                placeholder="Optional note for the timeline…"
                className="ml-auto w-64 rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
            </div>
            {lead.convertedAt && (
              <p className="mt-2 text-xs text-emerald-600">
                Converted {new Date(lead.convertedAt).toLocaleString()}
              </p>
            )}
          </section>

          {/* Details form */}
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold">Details</h2>
            <form onSubmit={onEdit} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium">
                Name
                <input name="name" defaultValue={lead.name} required className="input" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Source
                <select name="source" defaultValue={lead.source} className="input">
                  {LEAD_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Email
                <input
                  name="email"
                  type="email"
                  defaultValue={lead.email ?? ''}
                  className="input"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Phone
                <input name="phone" defaultValue={lead.phone ?? ''} className="input" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Priority
                <select name="priority" defaultValue={lead.priority} className="input">
                  {LEAD_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Preferred location
                <input
                  name="preferredLocation"
                  defaultValue={lead.preferredLocation ?? ''}
                  className="input"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Budget min
                <input
                  name="budgetMin"
                  type="number"
                  min="0"
                  defaultValue={lead.budgetMin ?? ''}
                  className="input"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Budget max
                <input
                  name="budgetMax"
                  type="number"
                  min="0"
                  defaultValue={lead.budgetMax ?? ''}
                  className="input"
                />
              </label>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Save details
                </button>
              </div>
            </form>
          </section>

          {/* Activity timeline */}
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold">Activity timeline</h2>
            <form onSubmit={onLogActivity} className="mt-3 flex flex-wrap items-center gap-2">
              <select name="type" defaultValue="NOTE" className="input w-28">
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                name="content"
                required
                placeholder="Log a call, email or note…"
                className="input flex-1"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Log
              </button>
            </form>
            <ol className="mt-4 flex flex-col gap-3">
              {activities.length === 0 && (
                <li className="text-sm text-zinc-500">No activity yet.</li>
              )}
              {activities.map((activity) => (
                <li key={activity.id} className="flex gap-3 text-sm">
                  <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-zinc-400">
                    {activity.type.replace(/_/g, ' ')}
                  </span>
                  <div className="flex-1">
                    <p className="text-zinc-800 dark:text-zinc-200">{activity.content}</p>
                    <p className="text-xs text-zinc-500">
                      {activity.user.name} · {new Date(activity.createdAt).toLocaleString()}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        {/* Right column: assignment + inquiries + site visits */}
        <div className="flex flex-col gap-6">
          {manager && (
            <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-sm font-semibold">Assignment</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Currently: {lead.assignedTo?.name ?? 'Unassigned'}
              </p>
              <div className="mt-3 flex gap-2">
                <select
                  className="input flex-1"
                  defaultValue={lead.assignedTo?.id ?? ''}
                  onChange={(e) => void run(() => api.leads.assign(id, e.target.value || null))}
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role})
                    </option>
                  ))}
                </select>
              </div>
            </section>
          )}

          {/* AI assist (Phase 6): real model calls through the API; every
              action lands in the timeline as an AI_ACTION activity. The hint
              box feeds all four actions. */}
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold">
              AI assist{' '}
              <span className="font-normal text-zinc-500">
                {lead.aiScore !== null
                  ? `— scored ${lead.aiScore}/100`
                  : '— not scored yet'}
              </span>
            </h2>
            {lead.aiScoreReason && (
              <p className="mt-1 text-xs text-zinc-500">{lead.aiScoreReason}</p>
            )}

            <label className="mt-3 block text-xs text-zinc-500">
              Hint for the AI (optional)
              <input
                value={aiNote}
                onChange={(e) => setAiNote(e.target.value)}
                placeholder="e.g. focus on budget fit, they loved the penthouse"
                className="input mt-1 block w-full"
              />
            </label>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                disabled={busy}
                onClick={() =>
                  void aiAction(
                    () => api.ai.score(id, aiNote.trim() || undefined),
                    // The score lands on the lead itself — reload() refreshes
                    // the header chip and reason; nothing transient to keep.
                    () => {}
                  )
                }
                className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Score lead
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void aiAction(
                    () => api.ai.draftEmail(id, aiNote.trim() || undefined),
                    (draft) => {
                      setAiDraft(draft);
                      setAiSummary(null);
                    },
                  )
                }
                className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Draft follow-up
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void aiAction(
                    () => api.ai.summarize(id, aiNote.trim() || undefined),
                    (result) => {
                      setAiSummary(result.summary);
                      setAiDraft(null);
                    },
                  )
                }
                className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Summarize
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void aiAction(
                    () => api.ai.suggestTasks(id, aiNote.trim() || undefined),
                    (result) => setAiSuggestions(result.suggestions),
                  )
                }
                className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Suggest tasks
              </button>
            </div>

            {aiDraft && (
              <div className="mt-3 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-700">
                <p className="font-medium">{aiDraft.subject}</p>
                <p className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                  {aiDraft.body}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() =>
                      void navigator.clipboard.writeText(`${aiDraft.subject}\n\n${aiDraft.body}`)
                    }
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Copy
                  </button>
                  <span className="text-xs text-zinc-400">model: {aiDraft.model}</span>
                </div>
              </div>
            )}

            {aiSummary && (
              <p className="mt-3 rounded-md border border-zinc-200 p-3 text-sm whitespace-pre-wrap text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
                {aiSummary}
              </p>
            )}

            {aiSuggestions.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {aiSuggestions.map((suggestion) => (
                  <li key={suggestion.title} className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{suggestion.title}</p>
                      <p className="text-xs text-zinc-500">
                        in {suggestion.dueInDays}d · {suggestion.reason}
                      </p>
                    </div>
                    <button
                      disabled={busy || accepting === suggestion.title}
                      onClick={() => void acceptSuggestion(suggestion)}
                      className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      {accepting === suggestion.title ? 'Adding…' : 'Add task'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Inquiries */}
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold">
              Property inquiries{' '}
              <span className="font-normal text-zinc-500">({lead.inquiries.length})</span>
            </h2>
            <div className="mt-3 flex flex-col gap-2">
              <input
                value={propertyQuery}
                onChange={(e) => setPropertyQuery(e.target.value)}
                placeholder="Search properties to add…"
                className="input"
              />
              {properties.slice(0, 5).map((property) => (
                <div
                  key={property.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-zinc-100 px-3 py-2 text-sm dark:border-zinc-800"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{property.title}</p>
                    <p className="truncate text-xs text-zinc-500">
                      {property.city} · {money(property.price)}
                    </p>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => void run(() => api.leads.addInquiry(id, property.id))}
                    className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Add
                  </button>
                </div>
              ))}
              <ol className="mt-2 flex flex-col gap-2">
                {lead.inquiries.map((inquiry) => (
                  <li key={inquiry.propertyId} className="text-sm">
                    <span className="font-medium">{inquiry.property.title}</span>{' '}
                    <span className="text-xs text-zinc-500">
                      {inquiry.property.status.toLowerCase()} ·{' '}
                      {new Date(inquiry.createdAt).toLocaleDateString()}
                    </span>
                    {inquiry.note && <p className="text-xs text-zinc-500">{inquiry.note}</p>}
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* Site visits */}
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold">
              Site visits{' '}
              <span className="font-normal text-zinc-500">({lead.siteVisits.length})</span>
            </h2>
            <ol className="mt-3 flex flex-col gap-2 text-sm">
              {lead.siteVisits.length === 0 && (
                <li className="text-zinc-500">No visits scheduled.</li>
              )}
              {lead.siteVisits.map((visit) => (
                <li key={visit.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {visit.property.title}{' '}
                    <span className="text-xs text-zinc-500">· {visit.status.toLowerCase()}</span>
                    <span className="block text-xs text-zinc-500">
                      {new Date(visit.scheduledAt).toLocaleString()}
                    </span>
                  </span>
                  {visit.status === 'SCHEDULED' && (
                    <span className="flex shrink-0 gap-1">
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(() => api.leads.updateVisit(id, visit.id, 'COMPLETED'))
                        }
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        Completed
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void run(() => api.leads.updateVisit(id, visit.id, 'NO_SHOW'))}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        No-show
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(() => api.leads.updateVisit(id, visit.id, 'CANCELLED'))
                        }
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                      >
                        Cancel
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ol>

            {/* Schedule a new visit — property comes from the shared catalog
                search above, datetime-local parses as local time (API coerces). */}
            <form
              onSubmit={(e) => void onScheduleVisit(e)}
              className="mt-3 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800"
            >
              <label className="text-xs text-zinc-500">
                Property
                <select name="propertyId" required className="input mt-1 block w-56">
                  <option value="">Choose a property…</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.title} · {property.city}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-zinc-500">
                When
                <input
                  name="scheduledAt"
                  type="datetime-local"
                  required
                  className="input mt-1 block"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Schedule
              </button>
            </form>
          </section>

          {/* Tasks on this lead; version bumps when an AI suggestion is
              accepted so the list refetches without a remount. */}
          <LeadTasks leadId={lead.id} version={tasksVersion} />
        </div>
      </div>
    </div>
  );
}

// Compact task list for the current lead: read-only summary + quick complete.
function LeadTasks({ leadId, version }: { leadId: string; version: number }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);

  const load = useCallback(() => {
    void api.tasks
      .list({ leadId, pageSize: 50 })
      .then((page) => setTasks(page.data))
      .catch(() => setTasks([]));
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load, version]);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold">Tasks</h2>
      <ol className="mt-3 flex flex-col gap-2 text-sm">
        {tasks === null && <li className="text-zinc-500">Loading…</li>}
        {tasks?.length === 0 && <li className="text-zinc-500">No tasks on this lead.</li>}
        {tasks?.map((task) => (
          <li key={task.id} className="flex items-start justify-between gap-2">
            <div>
              <p className={task.status === 'DONE' ? 'text-zinc-400 line-through' : ''}>
                {task.title}
                {task.isOverdue && task.status === 'PENDING' && (
                  <span className="ml-1 text-xs font-medium text-red-600">overdue</span>
                )}
              </p>
              <p className="text-xs text-zinc-500">
                {task.assignee.name} · due {new Date(task.dueAt).toLocaleDateString()}
              </p>
            </div>
            {task.status === 'PENDING' && (
              <button
                onClick={() =>
                  void api.tasks
                    .update(task.id, { status: 'DONE' })
                    .then(load)
                    .catch(() => undefined)
                }
                className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Complete
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
