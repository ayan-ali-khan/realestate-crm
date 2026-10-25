'use client';

// Client-side auth state. The API owns the session (httpOnly cookies, ADR-007);
// this context only mirrors "who am I" for rendering (nav, role-gated actions).
// A 401 from /auth/me means no/expired session — the gate sends those users to
// /login; every API call surfaces 401s the same way via this context.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setSessionExpiredHandler } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Initial session probe. setState lives only in async continuations —
    // never synchronously in the effect body (react-hooks/set-state-in-effect).
    let cancelled = false;
    api.auth
      .me()
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch(() => {
        // 401 = no session; anything else (network, 5xx) also lands signed-out —
        // the UI cannot identify a user it cannot fetch.
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // api.ts renews silently while the refresh cookie is alive; this handler
    // only runs when renewal itself fails — then the session is over and the
    // app must stop rendering as if the user were signed in.
    setSessionExpiredHandler(() => {
      setUser(null);
      router.push('/login');
    });
    return () => setSessionExpiredHandler(null);
  }, [router]);

  const login = useCallback(
    async (email: string, password: string) => {
      setUser(await api.auth.login({ email, password }));
      router.refresh();
    },
    [router],
  );

  const logout = useCallback(async () => {
    await api.auth.logout();
    setUser(null);
    router.push('/login');
    router.refresh();
  }, [router]);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Role helper: managers and admins get assignment/deletion powers. */
export function isManager(user: User | null): boolean {
  return user?.role === 'MANAGER' || user?.role === 'ADMIN';
}
