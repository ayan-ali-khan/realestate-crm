'use client';

// Team administration. Listing is useful to managers (lead assignment), so
// managers get a read-only roster; creating users and changing roles is
// ADMIN-only — hidden from managers here and rejected by requireRole('ADMIN')
// at the API regardless (defence in depth, never UI-trust).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth, isManager } from '@/lib/auth';
import type { Role, User } from '@/lib/types';

const ROLES: Role[] = ['AGENT', 'MANAGER', 'ADMIN'];

const ROLE_NOTE: Record<Role, string> = {
  AGENT: 'Own leads only',
  MANAGER: 'Assign & delete',
  ADMIN: 'Full access',
};

export default function UsersPage() {
  const { user } = useAuth();
  const admin = user?.role === 'ADMIN';
  const manager = isManager(user);

  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void api.users
      .list()
      .then((page) => {
        setUsers(page.data);
        setError(null);
      })
      .catch((err: unknown) => {
        setUsers(null);
        setError(err instanceof ApiError ? err.message : 'Failed to load users');
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget; // capture before await (synthetic events don't persist)
    const form = new FormData(formEl);
    setBusy(true);
    setNotice(null);
    try {
      const created = await api.users.create({
        name: String(form.get('name')).trim(),
        email: String(form.get('email')).trim(),
        password: String(form.get('password')),
        role: String(form.get('role')) as Role,
      });
      formEl.reset();
      setNotice(`${created.name} created`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create user');
    } finally {
      setBusy(false);
    }
  }

  async function onRoleChange(id: string, role: Role) {
    setBusy(true);
    setNotice(null);
    try {
      await api.users.setRole(id, role);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change role');
    } finally {
      setBusy(false);
    }
  }

  if (!manager) {
    return (
      <p className="py-12 text-center text-sm text-zinc-500">
        User administration is limited to managers and admins.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Team</h1>
        <p className="text-sm text-zinc-500">
          {users === null
            ? 'Loading team…'
            : `${users.length} user${users.length === 1 ? '' : 's'}`}
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
          {notice}
        </p>
      )}

      {admin && (
        <form
          onSubmit={(e) => void onCreate(e)}
          className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-2 lg:grid-cols-6"
        >
          <label className="text-sm">
            Name
            <input name="name" required maxLength={120} className="input w-full" placeholder="Jane Doe" />
          </label>
          <label className="text-sm">
            Email
            <input
              name="email"
              type="email"
              required
              className="input w-full"
              placeholder="jane@crm.test"
            />
          </label>
          <label className="text-sm">
            Password
            <input
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={72}
              className="input w-full"
              placeholder="At least 8 characters"
            />
          </label>
          <label className="text-sm">
            Role
            <select name="role" defaultValue="AGENT" className="input w-full">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Create user
            </button>
          </div>
          <p className="col-span-full text-xs text-zinc-500">{ROLE_NOTE.AGENT} · {ROLE_NOTE.MANAGER} · {ROLE_NOTE.ADMIN}</p>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {users === null && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                  {error ? '—' : 'Loading team…'}
                </td>
              </tr>
            )}
            {users?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                  No users yet.
                </td>
              </tr>
            )}
            {users?.map((member) => (
              <tr
                key={member.id}
                className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
              >
                <td className="px-4 py-3 font-medium">
                  {member.name}
                  {member.id === user?.id && (
                    <span className="ml-2 text-xs font-normal text-zinc-500">you</span>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{member.email}</td>
                <td className="px-4 py-3">
                  {admin ? (
                    <select
                      value={member.role}
                      disabled={busy || member.id === user?.id}
                      onChange={(e) => void onRoleChange(member.id, e.target.value as Role)}
                      title={
                        member.id === user?.id
                          ? 'You cannot change your own role'
                          : ROLE_NOTE[member.role]
                      }
                      className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm disabled:opacity-50 dark:border-zinc-700"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-zinc-600 dark:text-zinc-400">{member.role}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {member.createdAt ? new Date(member.createdAt).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!admin && (
        <p className="text-xs text-zinc-500">
          Creating users and changing roles requires an admin account.
        </p>
      )}
    </div>
  );
}
