# Deployment — running the CRM from your side

Every step below is something **you** do with provider accounts; nothing here
deploys automatically. Budget ~45 minutes end to end.

## What runs where

| Piece            | Suggested host                              | Why                                              |
| ---------------- | ------------------------------------------- | ------------------------------------------------ |
| API `apps/api`   | Render / Railway (Node 20+ web service)     | long-running Express + the two cron jobs          |
| Web `apps/web`   | Vercel (or the same provider as the API)    | first-class Next.js builds                       |
| Database         | Neon / Supabase / Render Postgres           | managed Postgres for Prisma                      |
| Photos           | Cloudinary account                          | CDN for property images — no server to run       |

The API and web can live under **one apex domain** (`app.example.com` +
`api.example.com`) or on **completely different domains** — production cookies
are `SameSite=None; Secure`, so both topologies work as long as everything is
HTTPS (all major hosts terminate TLS automatically).

## 0. Prerequisites

- This repo pushed to GitHub (lockfile is `bun.lock`, so the hosts need **Bun**
  for installs — Render/Railway/Vercel all detect it; with Node-only hosts run
  `bun install` in a build step that provides Bun).
- A Postgres 14+ database (cloud link or a fresh Neon project — free tier is
  enough).
- A Cloudinary account (free tier is enough) for property photos.

## 1. Database first (5 min)

1. Create the database (e.g. Neon) and copy the **pooled** connection string.
2. Apply the schema from any machine that can reach it:

```bash
cd apps/api
DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require" bunx prisma migrate deploy
# optional demo data (3 users, 15 properties, 40 leads):
DATABASE_URL="..." bun run db:seed
```

On Render/Railway put `bunx prisma migrate deploy` in the **post-deploy
command** so schema changes apply with every API deploy. Neon/GCP pooler URLs
need `sslmode=require`.

## 2. API service

| Setting         | Value                                                       |
| --------------- | ----------------------------------------------------------- |
| Root            | repo root (workspace `apps/api`)                            |
| Build command   | `bun install --frozen-lockfile && cd apps/api && bun run build` |
| Start command   | `cd apps/api && node dist/index.js`                         |
| Health check    | `/health` (add `?deep` to also check the DB)                |

Environment variables (host UI, never committed):

| Var                     | Value / how to get it                                        |
| ----------------------- | ------------------------------------------------------------ |
| `NODE_ENV`              | `production`                                                  |
| `DATABASE_URL`          | from step 1                                                   |
| `ACCESS_TOKEN_SECRET`   | `openssl rand -base64 32` (any ≥32 chars)                     |
| `REFRESH_TOKEN_SECRET`   | a **different** `openssl rand -base64 32`                    |
| `CORS_ORIGINS`          | the exact web origin: `https://your-app.vercel.app` (no trailing slash; comma-separate several) |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary dashboard → Product Environment Credentials (step 4) |
| `CLOUDINARY_API_KEY`    | same place                                                   |
| `CLOUDINARY_API_SECRET` | same place                                                   |
| `AI_API_KEY` (+ `AI_BASE_URL`, `AI_MODEL`) | optional — AI features answer 503 without it |
| `PORT`                  | leave unset — hosts inject it and the API reads it           |

Keep **one** API instance: the overdue-sync and token-prune cron jobs live in
the process (they're idempotent, but running them twice is pointless).

## 3. Web app

Framework preset: **Next.js** (Vercel: import the repo and set **Root
Directory = `apps/web`** — it's a monorepo).

| Var                 | Value                                          |
| ------------------- | ---------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | `https://<your-api-host>/api/v1`             |

Set this **before the build** — `NEXT_PUBLIC_*` values are baked into the
bundle at build time. Locally it defaults to
`http://localhost:4000/api/v1`, so no file is needed on your machine.

Redeploy the web app whenever you change it.

## 4. Cloudinary (property photos)

1. Sign up / log in at <https://console.cloudinary.com>.
2. Dashboard → **Product Environment Credentials** → copy **Cloud name**,
   **API key**, **API secret**.
3. Paste them into the API service env as `CLOUDINARY_CLOUD_NAME`,
   `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` → restart the service.
4. Uploads are proxied by the API (multer → Cloudinary SDK), so the secret
   never reaches the browser; the browser only ever sees
   `res.cloudinary.com` delivery URLs.

Without these three vars everything else still works — only the upload
endpoint answers 503, naming the missing vars.

## 5. Verify the deployment

1. `GET https://<api-host>/health?deep` → `data.db === "ok"`.
2. Open the web URL → it redirects to `/login` → sign in
   (`admin@crm.test` / `Password123!` if you seeded).
3. Browser console: **no CORS errors**; the network tab shows
   `/api/v1/auth/me` → 200 and the cookie `crm_access` is `HttpOnly` +
   `Secure` + `SameSite=None`.
4. Properties → **New property** → on the new card **Add images** (needs
   Cloudinary) → the thumbnail appears → ✕ removes it.
5. Sign out, sign back in — the rotating refresh flow works cross-site.

## 6. Troubleshooting

- **Login fails, console shows a CORS error** → `CORS_ORIGINS` must be the
  exact web origin (`https://` + host, no path, no trailing slash). After
  changing it, restart the API — CORS is configured at boot.
- **Redirect loop to `/login` while you just logged in** → the API origin in
  `NEXT_PUBLIC_API_URL` doesn't match the origin the cookie was set from, or
  the API isn't on HTTPS (production cookies are `Secure`).
- **`P1001` / 500 envelope during a deploy** → `DATABASE_URL` wrong or the
  pooler URL lacks `sslmode=require`.
- **Image upload 503 "not configured"** → any one of the three `CLOUDINARY_*`
  vars missing (all three are required).
- **`next/image` 400/error for an image host** → a delivery host outside
  `next.config.ts` → `images.remotePatterns` (seed photos `picsum.photos`,
  `res.cloudinary.com` uploads and `images.unsplash.com` are listed; a custom
  Cloudinary domain needs adding).
- **A Next route 404s on the host** → root directory isn't `apps/web`.
- **Cron runs twice** → more than one API replica; scale to one.