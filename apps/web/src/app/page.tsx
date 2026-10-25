'use client';

// Reviewer home — the post-login landing page (login and the proxy both send
// signed-in users here; the dashboard is one click away). Static content plus
// a greeting: no data fetching, so it renders instantly and the reviewer
// always has a calm starting point before diving into live data.
import Link from 'next/link';
import { useAuth, isManager } from '@/lib/auth';

const HIGHLIGHTS = [
  {
    href: '/dashboard',
    title: 'Overview',
    desc: 'Pipeline counts, overdue tasks and recent leads — summed from the same scoped endpoints the rest of the app uses.',
  },
  {
    href: '/leads',
    title: 'Leads pipeline',
    desc: 'Create, search and move leads through the stage machine. Assignment, property inquiries, site visits and the activity timeline all live on the lead page.',
  },
  {
    href: '/tasks',
    title: 'Tasks',
    desc: 'Follow-ups per lead, with overdue flags kept honest by a once-a-minute background job.',
  },
  {
    href: '/properties',
    title: 'Properties',
    desc: 'Searchable catalog that leads inquire against and book site visits for.',
  },
];

const CHECKLIST = [
  'Open any lead and use the AI assist panel — score, draft, summarize and suggest tasks are real model calls, each audited into the timeline as an AI_ACTION.',
  'Sign in as agent@crm.test: agents only ever see leads assigned to them, and another agent’s lead id answers 404 (no probing).',
  'Move a lead toward CLOSED_WON — the stage buttons come from the API’s transition table, and closed-won leads convert to customers.',
  'Watch the activity timeline: stage moves, visits, logs and AI actions all land there with the acting user attached.',
  'Repo docs for the full story: README.md, docs/WALKTHROUGH.md, docs/DECISIONS.md (ADRs), docs/DIAGRAMS.md, MOCKED.md.',
];

export default function HomePage() {
  const { user, loading } = useAuth();

  return (
    <div className="flex flex-col gap-8">
      {/* Hero */}
      <section className="rounded-xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-xs uppercase tracking-wide text-zinc-500">Real Estate CRM</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {loading ? 'Welcome' : `Welcome, ${user?.name ?? 'reviewer'}`}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          AI-powered lead management for real-estate teams: a typed Express API and a Next.js
          app, with real (never mocked) AI for lead scoring, follow-up drafting, interaction
          summaries and task suggestions.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Open dashboard →
          </Link>
          <Link
            href="/leads"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Jump to leads
          </Link>
          {user && (
            <span className="text-xs text-zinc-500">
              Signed in as {user.name} · {user.role}
              {isManager(user) ? ' · can assign, delete & see every lead' : ' · own leads only'}
            </span>
          )}
        </div>
      </section>

      {/* Feature map */}
      <section>
        <h2 className="text-sm font-semibold">What’s inside</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {HIGHLIGHTS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
            >
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{item.desc}</p>
            </Link>
          ))}
          {isManager(user) && (
            <Link
              href="/users"
              className="rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
            >
              <p className="text-sm font-semibold">Team</p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Roster management — create users and change roles (admin-only mutations).
              </p>
            </Link>
          )}
        </div>
      </section>

      {/* Reviewer checklist */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Where to look</h2>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
          {CHECKLIST.map((item) => (
            <li key={item} className="pl-1">
              {item}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
