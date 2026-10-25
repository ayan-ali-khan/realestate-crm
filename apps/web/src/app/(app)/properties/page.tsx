'use client';

// Property catalog + listings management. Browsing is open to every signed-in
// user (agents match leads to listings via inquiries); creating a listing and
// managing its Cloudinary image gallery is ADMIN/MANAGER — hidden here for
// agents and rejected by requireRole at the API regardless (defence in depth).
import { useEffect, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { api, ApiError } from '@/lib/api';
import { useAuth, isManager } from '@/lib/auth';
import { PROPERTY_STATUSES, PROPERTY_TYPES, type Paginated, type Property } from '@/lib/types';

function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

// Surface the first zod issue (path + message) instead of the generic
// "Request validation failed" envelope text.
function apiMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  const details = err.details;
  if (
    Array.isArray(details) &&
    details.length > 0 &&
    details[0] !== null &&
    typeof details[0] === 'object' &&
    'message' in details[0]
  ) {
    const issue = details[0] as { path?: unknown; message: string };
    const path = Array.isArray(issue.path) ? issue.path.join('.') : '';
    return path ? `${path}: ${issue.message}` : issue.message;
  }
  return err.message;
}

const STATUS_STYLE: Record<Property['status'], string> = {
  AVAILABLE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  RESERVED: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  SOLD: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

export default function PropertiesPage() {
  const { user } = useAuth();
  const manager = isManager(user);

  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  // Mutations bump this so the same debounced effect refetches the catalog
  // (filters own their own state; `page` resets in the change handlers).
  const [revision, setRevision] = useState(0);
  const [catalog, setCatalog] = useState<Paginated<Property> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // null = idle; 'create' or a property id = that target is in flight.
  const [busy, setBusy] = useState<string | null>(null);

  // Debounced fetch — every filter feeds one request (like the lead detail's
  // property picker). `page` resets in the change handlers, never in here
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void api.properties
        .list({
          q: query.trim() || undefined,
          type: type || undefined,
          status: status || undefined,
          page,
          pageSize: 24,
        })
        .then((res) => {
          if (!cancelled) {
            setCatalog(res);
            setError(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setCatalog(null);
            setError(err instanceof ApiError ? err.message : 'Failed to load properties');
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, type, status, page, revision]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget; // capture before await
    const form = new FormData(formEl);
    setBusy('create');
    setActionError(null);
    setNotice(null);
    try {
      await api.properties.create({
        title: String(form.get('title')).trim(),
        description: String(form.get('description')).trim(),
        price: Number(form.get('price')),
        location: String(form.get('location')).trim(),
        city: String(form.get('city')).trim(),
        type: String(form.get('type')) as Property['type'],
        bedrooms: Number(form.get('bedrooms') || 0),
        bathrooms: Number(form.get('bathrooms') || 0),
        areaSqft: Number(form.get('areaSqft')),
        amenities: String(form.get('amenities') ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      formEl.reset();
      setShowCreate(false);
      setNotice('Property created — add photos from its card below.');
      setRevision((r) => r + 1);
    } catch (err) {
      setActionError(apiMessage(err, 'Failed to create property'));
    } finally {
      setBusy(null);
    }
  }

  async function onAddImages(id: string, input: HTMLInputElement) {
    const files = Array.from(input.files ?? []); // read before any await
    if (files.length === 0) return;
    setBusy(id);
    setActionError(null);
    setNotice(null);
    try {
      await api.properties.addImages(id, files);
      setNotice(`Added ${files.length} image${files.length === 1 ? '' : 's'}.`);
      setRevision((r) => r + 1);
    } catch (err) {
      setActionError(apiMessage(err, 'Image upload failed'));
    } finally {
      setBusy(null);
      input.value = ''; // re-picking the same file must fire onChange again
    }
  }

  async function onRemoveImage(id: string, index: number) {
    setBusy(id);
    setActionError(null);
    setNotice(null);
    try {
      await api.properties.removeImage(id, index);
      setNotice('Image removed.');
      setRevision((r) => r + 1);
    } catch (err) {
      setActionError(apiMessage(err, 'Failed to remove image'));
    } finally {
      setBusy(null);
    }
  }

  const totalPages = catalog?.meta.totalPages ?? 1;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Properties</h1>
          <p className="text-sm text-zinc-500">
            {catalog === null
              ? 'Loading listings…'
              : `${catalog.meta.total} listing${catalog.meta.total === 1 ? '' : 's'}`}
          </p>
        </div>
        {manager && (
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {showCreate ? 'Close' : 'New property'}
          </button>
        )}
      </div>

      {showCreate && manager && (
        <form
          onSubmit={(e) => void onCreate(e)}
          className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-3"
        >
          <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
            Title *
            <input
              name="title"
              required
              minLength={3}
              maxLength={200}
              className="input"
              placeholder="Sunlit 2BR with skyline views"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Price (USD) *
            <input name="price" type="number" min="1" required className="input" placeholder="425000" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-3">
            Description *
            <textarea
              name="description"
              required
              rows={2}
              className="input"
              placeholder="Short listing description…"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Location *
            <input name="location" required className="input" placeholder="5th Avenue, Midtown" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            City *
            <input name="city" required className="input" placeholder="New York" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Type *
            <select name="type" defaultValue="APARTMENT" className="input">
              {PROPERTY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Bedrooms
            <input name="bedrooms" type="number" min="0" defaultValue={0} className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Bathrooms
            <input name="bathrooms" type="number" min="0" defaultValue={0} className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Area (sqft) *
            <input name="areaSqft" type="number" min="1" required className="input" placeholder="1150" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
            Amenities (comma-separated)
            <input name="amenities" className="input" placeholder="Pool, Gym, Parking" />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={busy === 'create'}
              className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {busy === 'create' ? 'Creating…' : 'Create property'}
            </button>
          </div>
          <p className="col-span-full text-xs text-zinc-500">
            Photos are added per property after creation (up to 8, 5&nbsp;MB each) through the
            Cloudinary integration — see docs/WALKTHROUGH.md.
          </p>
        </form>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search title, location, city…"
          className="w-64 rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
        >
          <option value="">All types</option>
          {PROPERTY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
        >
          <option value="">All statuses</option>
          {PROPERTY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {actionError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {actionError}
        </p>
      )}
      {notice && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Catalog grid */}
      {catalog === null && !error ? (
        <p className="py-12 text-center text-sm text-zinc-500">Loading properties…</p>
      ) : catalog && catalog.data.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">
          No properties match these filters.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {catalog?.data.map((property) => {
            const full = property.images.length >= 8;
            const busyCard = busy === property.id;
            return (
              <article
                key={property.id}
                className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                {property.images[0] ? (
                  <Image
                    src={property.images[0]}
                    alt={property.title}
                    width={640}
                    height={288}
                    className="h-36 w-full rounded-md bg-zinc-100 object-cover dark:bg-zinc-800"
                  />
                ) : (
                  <div className="flex h-36 w-full items-center justify-center rounded-md border border-dashed border-zinc-300 text-xs text-zinc-400 dark:border-zinc-700">
                    No photos yet
                  </div>
                )}
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold leading-snug">{property.title}</h2>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[property.status]}`}
                  >
                    {property.status}
                  </span>
                </div>
                <p className="text-xs text-zinc-500">
                  {property.location} · {property.city}
                </p>
                <p className="text-base font-semibold tabular-nums">{money(property.price)}</p>
                <p className="text-xs text-zinc-500">
                  {property.type.replace(/_/g, ' ')} · {property.bedrooms} bed ·{' '}
                  {property.bathrooms} bath · {property.areaSqft.toLocaleString()} sqft
                </p>

                {manager && (
                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                    <label
                      className={`rounded-md border border-zinc-300 px-2 py-1 text-xs transition-colors dark:border-zinc-700 ${
                        busyCard || full
                          ? 'pointer-events-none opacity-50'
                          : 'cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {busyCard ? 'Working…' : full ? 'Gallery full' : '+ Add images'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        multiple
                        disabled={busyCard || full}
                        className="hidden"
                        onChange={(e) => void onAddImages(property.id, e.currentTarget)}
                      />
                    </label>
                    <span className="text-[11px] text-zinc-400">
                      {property.images.length}/8 · max 5 MB each
                    </span>
                    {property.images.map((url, index) => (
                      <button
                        key={`${url}-${index}`}
                        type="button"
                        onClick={() => void onRemoveImage(property.id, index)}
                        disabled={busyCard}
                        title="Remove this image"
                        className="group relative h-9 w-9 overflow-hidden rounded border border-zinc-200 disabled:opacity-50 dark:border-zinc-700"
                      >
                        <Image src={url} alt="" width={36} height={36} className="h-full w-full object-cover" />
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-bold text-white opacity-0 transition-opacity group-hover:opacity-100">
                          ✕
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {catalog !== null && totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
          >
            Previous
          </button>
          <span className="text-zinc-500">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}