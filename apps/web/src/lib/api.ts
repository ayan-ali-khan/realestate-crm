// Typed API client for apps/api. One place that knows about the wire format:
// { success, data, error } envelope, cookie credentials, and the REST paths.
// Cookies are httpOnly (ADR-007) — the browser attaches them; we never touch
// tokens in JS.
import type {
  Activity,
  AiEmailDraft,
  AiScoreResult,
  AiSummary,
  AiTaskSuggestions,
  CreateLeadBody,
  CreatePropertyBody,
  Envelope,
  Inquiry,
  Lead,
  LeadDetail,
  LeadFilters,
  Paginated,
  Property,
  Role,
  SiteVisit,
  Task,
  TaskFilters,
  TaskStatus,
  User,
} from './types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

// --- silent session renewal (ADR-007) -------------------------------------
// The access cookie expires after 15 minutes (Max-Age=900) while the refresh
// cookie lives 7 days on path /api/v1/auth. Once the access cookie is gone the
// browser stops sending it, so every call would 401 forever without this.
// On a 401 we refresh once and replay the original request.
//
// Refresh tokens rotate: the presented token is revoked and a new pair issued,
// so two concurrent refreshes would revoke each other and log the user out.
// Every 401 therefore shares ONE in-flight refresh (the module-level promise).
type Renewal = 'ok' | 'expired' | 'unknown';
let renewal: Promise<Renewal> | null = null;

function renewSession(): Promise<Renewal> {
  if (!renewal) {
    renewal = (async (): Promise<Renewal> => {
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
        });
        if (res.ok) return 'ok';
        // 401/403 means the refresh token itself is gone (rotated away, expired
        // or revoked) — the session is genuinely over. Anything else (429, 5xx)
        // is a transient failure and must not end somebody's session.
        return res.status === 401 || res.status === 403 ? 'expired' : 'unknown';
      } catch {
        return 'unknown'; // network blip: surface the original 401 instead
      }
    })().finally(() => {
      renewal = null; // a later expiry must be able to renew again
    });
  }
  return renewal;
}

// Endpoints whose 401 is a legitimate answer, not an expired session:
// wrong password (login), an already-dead token (refresh), a completed logout.
const NO_RENEWAL = ['/auth/login', '/auth/refresh', '/auth/logout'];
const canRenew = (path: string): boolean => !NO_RENEWAL.some((p) => path.startsWith(p));

// Client navigation can't reach proxy.ts, so a dead session has to leave the
// app itself. AuthProvider registers the handler (it owns the router and the
// user state, and router.push avoids a full reload); without one — tests, or
// code running before the provider mounts — we do nothing and the 401 simply
// surfaces as an ApiError, which is the pre-renewal behaviour anyway.
let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

function endSession(): void {
  onSessionExpired?.();
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    // httpOnly cookies ride along; required for the authed API.
    credentials: 'include',
    // JSON by default — but never when the body is FormData: the browser has
    // to set the multipart boundary itself (property image uploads).
    headers: {
      ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  // 204 No Content has no body to parse.
  if (res.status === 204) return undefined as T;

  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError(res.status, 'BAD_RESPONSE', `Malformed response from ${path}`);
  }

  if (!res.ok || !body.success) {
    const onLoginPage = typeof window !== 'undefined' && window.location.pathname === '/login';
    if (res.status === 401 && !retried && canRenew(path) && !onLoginPage) {
      const state = await renewSession();
      if (state === 'ok') return request<T>(path, init, true); // fresh cookie attached
      if (state === 'expired') endSession();
      // 'unknown': fall through and surface the original 401.
    }
    throw new ApiError(
      res.status,
      body.error?.code ?? 'UNKNOWN',
      body.error?.message ?? `Request failed (${res.status})`,
      body.error?.details,
    );
  }
  return body.data as T;
}

const qs = (params: object): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const api = {
  auth: {
    me: () => request<User>('/auth/me'),
    login: (body: { email: string; password: string }) =>
      request<User>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
  },

  users: {
    list: () => request<Paginated<User>>('/users?pageSize=100'),
    // Mutations are ADMIN-only at the route level (requireRole) — the users
    // page hides them from managers, the API rejects them regardless.
    create: (body: { name: string; email: string; password: string; role: Role }) =>
      request<User>('/users', { method: 'POST', body: JSON.stringify(body) }),
    setRole: (id: string, role: Role) =>
      request<User>(`/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  },

  leads: {
    list: (filters: LeadFilters = {}) =>
      request<Paginated<Lead>>(`/leads${qs({ ...filters, converted: filters.converted })}`),
    get: (id: string) => request<LeadDetail>(`/leads/${id}`),
    create: (body: CreateLeadBody) =>
      request<LeadDetail>('/leads', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Partial<CreateLeadBody>) =>
      request<LeadDetail>(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) => request<void>(`/leads/${id}`, { method: 'DELETE' }),
    changeStage: (id: string, stage: string, note?: string) =>
      request<LeadDetail>(`/leads/${id}/stage`, {
        method: 'POST',
        body: JSON.stringify({ stage, ...(note ? { note } : {}) }),
      }),
    assign: (id: string, assignedToId: string | null) =>
      request<LeadDetail>(`/leads/${id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ assignedToId }),
      }),
    addInquiry: (id: string, propertyId: string, note?: string) =>
      request<Inquiry>(`/leads/${id}/inquiries`, {
        method: 'POST',
        body: JSON.stringify({ propertyId, ...(note ? { note } : {}) }),
      }),
    scheduleVisit: (id: string, propertyId: string, scheduledAt: string) =>
      request<SiteVisit>(`/leads/${id}/visits`, {
        method: 'POST',
        body: JSON.stringify({ propertyId, scheduledAt }),
      }),
    updateVisit: (id: string, visitId: string, status: SiteVisit['status']) =>
      request<SiteVisit>(`/leads/${id}/visits/${visitId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    activities: (id: string, page = 1) =>
      request<Paginated<Activity>>(`/leads/${id}/activities?page=${page}`),
    logActivity: (id: string, type: string, content: string) =>
      request<Activity>(`/leads/${id}/activities`, {
        method: 'POST',
        body: JSON.stringify({ type, content }),
      }),
  },

  tasks: {
    list: (filters: TaskFilters = {}) => request<Paginated<Task>>(`/tasks${qs(filters)}`),
    create: (body: { leadId: string; title: string; dueAt: string; assigneeId?: string }) =>
      request<Task>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
    update: (
      id: string,
      body: { status?: TaskStatus; title?: string; dueAt?: string; assigneeId?: string },
    ) => request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  },

  // AI features (Phase 6). Every endpoint answers 503 EXTERNAL_SERVICE_ERROR
  // until the API has AI_API_KEY — surfaced as a normal ApiError message.
  ai: {
    score: (id: string, note?: string) =>
      request<AiScoreResult>(`/leads/${id}/ai/score`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    draftEmail: (id: string, note?: string) =>
      request<AiEmailDraft>(`/leads/${id}/ai/draft-email`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    summarize: (id: string, note?: string) =>
      request<AiSummary>(`/leads/${id}/ai/summarize`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    suggestTasks: (id: string, note?: string) =>
      request<AiTaskSuggestions>(`/leads/${id}/ai/suggest-tasks`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
  },

  properties: {
    list: (
      filters: {
        q?: string;
        city?: string;
        type?: string;
        status?: string;
        page?: number;
        pageSize?: number;
      } = {},
    ) => request<Paginated<Property>>(`/properties${qs({ pageSize: 50, ...filters })}`),
    // Writes are ADMIN/MANAGER at the route (requireRole) — the UI hides them
    // from agents, the API rejects them regardless.
    create: (body: CreatePropertyBody) =>
      request<Property>('/properties', { method: 'POST', body: JSON.stringify(body) }),
    addImages: (id: string, files: File[]) => {
      const form = new FormData();
      for (const file of files) form.append('images', file);
      return request<Property>(`/properties/${id}/images`, { method: 'POST', body: form });
    },
    removeImage: (id: string, index: number) =>
      request<Property>(`/properties/${id}/images/${index}`, { method: 'DELETE' }),
  },
};
