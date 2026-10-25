# Real Estate CRM — AI-powered lead management

Assessment project: a full-stack Real Estate CRM with **real** (non-mocked) AI features for
lead scoring, follow-up email drafting, interaction summaries, and task suggestions.

## Current status

| Phase | Scope                             | Status  |
| ----- | --------------------------------- | ------- |
| 0     | Repo scaffold, tooling, env setup | ✅ done |
| 1     | DB schema, migrations, seed       | ✅ done |
| 2     | Backend foundation + auth + RBAC  | ✅ done |
| 3     | Leads, activities, tasks APIs     | ✅ done |
| 4     | Background jobs (cron)            | ✅ done |
| 5     | UI (leads, tasks, properties, team, overview) | ✅ done |
| 6     | AI features (scoring, drafting, summaries, suggestions) | ✅ done |

## Stack (and why)

- **Bun** locally (runtime + package manager) — this machine has no Node.js; all code stays
  Node-compatible so Vercel/Render deploys run plain Node 20+.
- **Next.js 16 (App Router) + TypeScript + Tailwind v4** for the frontend — SSR/RSC, first-class
  Vercel deployment, and a typed end-to-end path to the API.
- **Express 5 + TypeScript (ESM)** for the REST API — mature middleware ecosystem; Express 5
  forwards async handler errors to error middleware automatically.
- **PostgreSQL + Prisma** — relational data with strong integrity (pipeline stages, assignments,
  analytics); Prisma gives type-safe queries and versioned migrations. The database runs on a
  **cloud Postgres** (link to be provided) — see `docker-compose.yml` only as an optional local
  alternative.

## Monorepo layout

```
apps/
  api/    Express 5 REST API        (@crm/api)
  web/    Next.js App Router app    (@crm/web)
docs/     ADRs, walkthrough, diagrams
```

## Quick start (Phase 0)

```bash
bun install                # installs all workspaces

cp .env.example .env               # root env (compose defaults)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

bun run dev:api             # API on http://localhost:4000 (health: /health)
bun run dev:web             # Web on http://localhost:3000
```

Database (needs a `DATABASE_URL` in `apps/api/.env` — cloud Postgres link):

```bash
bun run --filter @crm/api db:migrate   # apply migrations + create tables
bun run --filter @crm/api db:seed      # 3 users, 15 properties, 40 leads (+activities/tasks/visits)
bun run --filter @crm/api db:studio    # browse data in Prisma Studio
```

Seed logins: `admin@crm.test` / `manager@crm.test` / `agent@crm.test`, password
`Password123!` (override with `SEED_PASSWORD`).

## Scripts

| Script              | What it does                    |
| ------------------- | ------------------------------- |
| `bun run dev:api`   | Run the API with hot reload     |
| `bun run dev:web`   | Run the frontend dev server     |
| `bun run typecheck` | TypeScript, both apps           || `bun run lint`      | ESLint, both apps                    |
| `bun run build`     | Production build, both apps          |
| `bun run test`      | API integration tests (test DB) |
| `bun run format`    | Prettier write                  |

## Environment variables

| Var                    | Where    | Purpose                                             |
| ---------------------- | -------- | --------------------------------------------------- |
| `PORT`                 | apps/api | API port (default 4000)                             |
| `DATABASE_URL`         | apps/api | Postgres connection string                          |
| `CORS_ORIGINS`         | apps/api | CORS allowlist (comma-separated)                    |
| `ACCESS_TOKEN_SECRET`  | apps/api | JWT signing key (access, 15m)                       |
| `REFRESH_TOKEN_SECRET` | apps/api | JWT signing key (refresh, 7d)                       |
| `ACCESS_TOKEN_TTL`     | apps/api | Access token lifetime (15m)                         || `REFRESH_TOKEN_TTL`  | apps/api | Refresh token lifetime (7d)                         |
| `AI_API_KEY`         | apps/api | LLM provider key — unset = AI endpoints answer 503  |
| `AI_BASE_URL`        | apps/api | OpenAI-compatible base URL (default OpenAI)         |
| `AI_MODEL`           | apps/api | Model id (default `gpt-6-luna`)                     |
| `AI_TIMEOUT_MS`      | apps/api | Per AI-call timeout (default 30000)                 |
| `CLOUDINARY_CLOUD_NAME` | apps/api | Cloudinary cloud — unset = image uploads answer 503 |
| `CLOUDINARY_API_KEY`    | apps/api | Cloudinary API key (stays server-side)              |
| `CLOUDINARY_API_SECRET` | apps/api | Cloudinary API secret (stays server-side)           |
| `RATE_LIMIT_MAX`       | apps/api | Global requests/min (300)                           |
| `AUTH_RATE_LIMIT_MAX`  | apps/api | Auth requests/min (20)                              |
| `CRON_ENABLED`         | apps/api | Run background jobs (default on; off in tests)      |
| `OVERDUE_SYNC_CRON`    | apps/api | Overdue-flag sync schedule (default `* * * * *`)    |
| `TOKEN_PRUNE_CRON`     | apps/api | Refresh-token prune schedule (default `17 3 * * *`) |
| `NEXT_PUBLIC_API_URL`  | apps/web | Base URL of the API                                 |

## API overview (v1)

| Method | Path                           | Auth           | Purpose                                   |
| ------ | ------------------------------ | -------------- | ----------------------------------------- |
| GET    | `/health`                      | —              | Liveness; `?deep` checks the DB           |
| POST   | `/api/v1/auth/register`        | —              | Register (AGENT), sets cookies            |
| POST   | `/api/v1/auth/login`           | —              | Login, sets cookies                       |
| POST   | `/api/v1/auth/refresh`         | refresh cookie | Rotate tokens                             |
| POST   | `/api/v1/auth/logout`          | —              | Revoke + clear cookies                    |
| GET    | `/api/v1/auth/me`              | access cookie  | Current user                              |
| GET    | `/api/v1/users`                | ADMIN, MANAGER | Paginated user list                       |
| POST   | `/api/v1/users`                | ADMIN          | Create user                               |
| PATCH  | `/api/v1/users/:id/role`       | ADMIN          | Change role                               |
| GET    | `/api/v1/leads`                | access cookie  | List + filter leads (agents: own only)    |
| POST   | `/api/v1/leads`                | access cookie  | Create lead                               |
| GET    | `/api/v1/leads/:id`            | access cookie  | Lead detail (+ counts)                    |
| PATCH  | `/api/v1/leads/:id`            | access cookie  | Update fields (never stage/assignee)      |
| DELETE | `/api/v1/leads/:id`            | ADMIN, MANAGER | Soft delete                               |
| POST   | `/api/v1/leads/:id/stage`      | access cookie  | Pipeline stage transition (validated)     |
| POST   | `/api/v1/leads/:id/assign`     | ADMIN, MANAGER | Assign / unassign lead                    |
| POST   | `/api/v1/leads/:id/inquiries`  | access cookie  | Add property interest                     |
| POST   | `/api/v1/leads/:id/visits`     | access cookie  | Schedule a site visit                     |
| PATCH  | `/api/v1/leads/:id/visits/:visitId` | access cookie | Visit status: COMPLETED / NO_SHOW / CANCELLED |
| POST   | `/api/v1/leads/:id/ai/score`    | access cookie  | AI lead score (real model call)           |
| POST   | `/api/v1/leads/:id/ai/draft-email` | access cookie | AI follow-up email draft                  |
| POST   | `/api/v1/leads/:id/ai/summarize` | access cookie  | AI interaction summary                    |
| POST   | `/api/v1/leads/:id/ai/suggest-tasks` | access cookie | AI task suggestions (never auto-creates) |
| GET    | `/api/v1/leads/:id/activities` | access cookie  | Interaction timeline (+filter)            |
| POST   | `/api/v1/leads/:id/activities` | access cookie  | Log CALL/EMAIL/NOTE                       |
| GET    | `/api/v1/tasks`                | access cookie  | List tasks (agents: own; `?overdue=true`) |
| POST   | `/api/v1/tasks`                | access cookie  | Create task on an accessible lead         |
| PATCH  | `/api/v1/tasks/:id`            | access cookie  | Update task (reassign: managers only)     |
| GET    | `/api/v1/properties`           | access cookie  | Property catalog (search + filters)       |
| POST   | `/api/v1/properties`           | ADMIN, MANAGER | Create a listing                          |
| POST   | `/api/v1/properties/:id/images` | ADMIN, MANAGER | Upload photos (multipart `images`, ≤8 × 5 MB) |
| DELETE | `/api/v1/properties/:id/images/:index` | ADMIN, MANAGER | Remove one photo                    |

## AI features (Phase 6)

Real model calls — nothing mocked. Lead scoring, follow-up drafting,
interaction summaries and task suggestions live under
`/api/v1/leads/:id/ai/*`, surface in the lead-detail **AI assist** panel, and
every action is logged to the timeline as an `AI_ACTION` activity.

Set `AI_API_KEY` in `apps/api/.env` (and optionally `AI_BASE_URL` /`AI_MODEL`).
Any OpenAI-compatible provider works — OpenAI is the default; e.g. Groq
(`https://api.groq.com/openai/v1`), OpenRouter (`https://openrouter.ai/api/v1`)
or Gemini's compat layer
(`https://generativelanguage.googleapis.com/v1beta/openai/`). Without a key,
those endpoints answer 503 and the rest of the CRM runs normally. See
[ADR-011](docs/DECISIONS.md).

## Property images (Cloudinary)

Listing photos upload through the API to Cloudinary — the API key/secret stay
server-side and the browser only ever sees delivery URLs. Put the three
`CLOUDINARY_*` values (Cloudinary dashboard → Product Environment Credentials)
into `apps/api/.env` and restart the API. With no credentials the upload
endpoint answers 503 naming those vars — the same optional-dependency
contract as `AI_API_KEY` — while creating and browsing properties keeps
working. Each listing holds up to 8 photos (5 MB each, JPEG/PNG/WebP/GIF);
*New property* and *Add images* live on `/properties` for ADMIN/MANAGER.
See [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md) for the click path and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for going live.

## Docs

- [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md) — demo walkthrough for reviewers
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deploying API, web, database and Cloudinary from your side
- [docs/DECISIONS.md](docs/DECISIONS.md) — architecture decision records
- [docs/DIAGRAMS.md](docs/DIAGRAMS.md) — ER model + auth / pipeline / AI flow diagrams
- [MOCKED.md](MOCKED.md) — anything mocked (currently: nothing)
