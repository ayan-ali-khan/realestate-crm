'use client';

// Authenticated app shell: top nav (Leads / Tasks), current user, sign-out.
// Rendered under the (app) route group; proxy.ts already bounced unauthenticated
// visitors to /login, but a stale cookie can still land here — the user chip
// stays empty and any API 401 is visible in the page bodies.
//
// `usePathname` lives in the smallest possible leaf (NavLinks) inside a
// Suspense boundary: on routes with dynamic params the pathname isn't known
// during prerender, and an unbounded read would fail the build
// (CLIENT_HOOK_DYNAMIC — Next 16 cacheComponents rule).
import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth, isManager } from '@/lib/auth';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/dashboard', label: 'Overview' },
  { href: '/leads', label: 'Leads' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/properties', label: 'Properties' },
  // The roster is manager/admin-only at the API (requireRole); agents never
  // see a nav entry that would 403 them.
  { href: '/users', label: 'Team', managerOnly: true },
];

function NavLinks() {
  const pathname = usePathname();
  const { user } = useAuth();
  const manager = isManager(user);
  const items = NAV.filter((item) => !item.managerOnly || manager);
  return (
    <nav className="flex gap-1">
      {items.map((item) => {
        // Root is exact-match: every path starts with '/', which would
        // otherwise highlight Home on every page.
        const active =
          item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              active
                ? 'bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Real&nbsp;Estate&nbsp;CRM
          </Link>
          <Suspense fallback={<nav className="flex gap-1" aria-hidden="true" />}>
            <NavLinks />
          </Suspense>

          <div className="ml-auto flex items-center gap-3">
            {user && (
              <div className="text-right leading-tight">
                <div className="text-sm font-medium">{user.name}</div>
                <div className="text-xs text-zinc-500">
                  {user.role}
                  {isManager(user) ? ' · can assign & delete' : ''}
                </div>
              </div>
            )}
            <button
              onClick={() => void logout()}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
