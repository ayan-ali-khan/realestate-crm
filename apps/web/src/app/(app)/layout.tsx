import { Suspense } from 'react';
import { Shell } from './shell';

// Every page under (app) is behind the auth cookie and renders client-fetched
// data — there is no meaningful static shell to prerender, and the shell's
// client hooks (usePathname/useAuth) can't resolve at build time. Next 16's
// documented opt-out for exactly this: a blocking segment below which nothing
// is validated as instant (static-shell validation is disabled for this tree).
export const instant = false;

// Route group for authenticated pages. proxy.ts gates entry; Shell owns the
// nav chrome. Kept as a server component so it adds no client JS of its own.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  // The static shell is just the fallback; the authenticated client tree
  // (Shell + pages) streams in at request time.
  return (
    <Suspense fallback={<p className="py-12 text-center text-sm text-zinc-500">Loading…</p>}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
