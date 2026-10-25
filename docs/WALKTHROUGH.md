# Demo walkthrough — reviewer guide

A 15-minute path through the Real Estate CRM that touches every claimed feature.
Everything below runs locally against your own database; nothing in this project
is mocked ([MOCKED.md](../MOCKED.md) is empty by rule).

## Quick start

```bash
bun install                          # installs both workspaces

cp .env.example .env                 # root (compose defaults)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# Point apps/api/.env at a Postgres (cloud link or docker compose up -d)
bun run --filter @crm/api db:migrate # create tables
bun run --filter @crm/api db:seed    # 3 users, 15 properties, 40 leads + activities/tasks/visits

bun run dev:api                      # http://localhost:4000  (health: /health?deep)
bun run dev:web                      # http://localhost:3000
```

Open http://localhost:3000 — unauthenticated visitors are routed to `/login`.

## Seed accounts

| Email                | Role    | What it demonstrates                            |
| -------------------- | ------- | ------------------------------------------------ |
| `admin@crm.test`     | ADMIN   | everything + user management (`/users`)          |
| `manager@crm.test`   | MANAGER | all leads, assignment, deletion, converted filter |
| `agent@crm.test`     | AGENT   | only their own leads — cross-scope ids answer 404 |

Password for all three: `Password123!` (override with `SEED_PASSWORD` before seeding).

## Suggested review path

1. **Login as `agent@crm.test`.** Cookies are httpOnly (ADR-007): the access
   token lives 15 minutes and renews silently through a rotating refresh token.
   You never see a token in JS or browser storage.
2. **Home (`/`).** The reviewer landing page: feature map, review checklist and
   a prominent *Open dashboard* button.
3. **Dashboard (`/dashboard`).** Pipeline counts, overdue/pending tasks and
   recent leads — summed with `meta.total` from the same scoped list endpoints
   the UI uses, so an agent's overview only ever contains their own work.
4. **Leads (`/leads`).** Create a lead (an agent's lead auto-assigns to
   themselves; at least one of email/phone is required). Filters live in the
   URL — shareable and back-button friendly.
5. **Lead detail (`/leads/:id`).** The workbench: the stage buttons are
   rendered from `allowedTransitions` returned by the API (the API's stage
   machine is the single source of truth, ADR-009 — try moving a `NEW_LEAD`
   straight to `NEGOTIATION` via curl and you get a 409 naming the legal
   targets). Log a call/note/email into the activity timeline.
6. **AI assist panel (same page).** Four actions — *Score lead*, *Draft
   follow-up*, *Summarize*, *Suggest tasks*. These are **real model calls**
   (see [AI configuration](#ai-configuration)). The score persists onto the
   lead; every action writes an `AI_ACTION` entry to the timeline with the
   acting user and model in metadata. Suggestion acceptance creates a task
   through the normal task endpoint — the AI never writes to the database
   directly.
7. **Switch to `manager@crm.test`.** Now every lead is visible, the assignment
   panel and Delete work, and the leads list gains a *converted* filter.
   Reassign a lead to yourself, then back — access follows the assignment.
8. **Properties (`/properties`).** As manager/admin, *New property* creates a
   listing; the card's *Add images* uploads photos to Cloudinary (up to 8 ×
   5 MB each) and the ✕ overlay removes one — see
   [Property image configuration](#property-image-configuration-cloudinary).
   Without `CLOUDINARY_*` set, the upload 503s naming those vars — exactly
   like the AI key.
9. **Background jobs.** `overdue-sync` runs every minute (watch a task's
   overdue flag flip as its due date passes) and `token-prune` sweeps expired
   refresh tokens nightly — ADR-010, env-tunable, disabled in tests.
10. **Tests.** `bun run test` (from `apps/api`) — the integration suite across
   9 suites against an isolated `*_test` database that global-setup
   provisions, migrates and seeds per run. The AI suite deletes the provider
   key so its 503 contract is deterministic and can never spend money.

## AI configuration

The AI layer speaks to **any OpenAI-compatible endpoint** (ADR-011) via two env
vars in `apps/api/.env`:

```bash
AI_API_KEY=...        # unset = AI endpoints answer 503, rest of the CRM works
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/   # Gemini compat example
AI_MODEL=gemini-3.6-flash
AI_TIMEOUT_MS=45000
```

OpenAI, Groq, OpenRouter, DeepSeek and Gemini all work by changing
`AI_BASE_URL` + `AI_MODEL` — no code change. Responses are schema-validated
(zod) on the way back; an unparseable answer is a 502, never a silently wrong
score.

## Property image configuration (Cloudinary)

`POST /api/v1/properties/:id/images` streams uploads to Cloudinary from the
API server — the credentials never reach the browser. It follows the same
optional-dependency contract as the AI key: with the three vars unset the
endpoint answers 503 naming them, and everything else keeps working.

```bash
# apps/api/.env — from https://console.cloudinary.com → Dashboard →
# Product Environment Credentials (Cloud name, API key, API secret)
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

Creating listings and adding/removing photos lives on `/properties`
(ADMIN/MANAGER — hidden from agents and rejected by the API regardless): *New
property* creates a row, then *Add images* on its card uploads up to 8 photos
(JPEG/PNG/WebP/GIF). The ✕ overlay on a thumbnail removes it — the URL leaves
the database and the asset is deleted from the CDN best-effort.

## Troubleshooting

- **`P1001 Can't reach database server` / a 500 envelope during a cloud-DB
  blip.** Your Postgres pooler dropped a connection; retry the request. The
  every-minute cron jobs self-heal by design (ADR-010).
- **429 from auth endpoints.** The auth limiter is 20/min per IP by design
  (`AUTH_RATE_LIMIT_MAX`); the global limiter is 300/min.
- **Changed `schema.prisma`?** `bun run --filter @crm/api db:generate` then
  `db:migrate dev`.
- **AI endpoints answer 503 "set AI_API_KEY".** Working as intended — see AI
  configuration above.
- **Property image upload answers 503 "not configured".** Expected until the
  three `CLOUDINARY_*` vars are set in `apps/api/.env` — see Property image
  configuration above.

## Repo doc map

| Doc                                            | What it holds                              |
| ---------------------------------------------- | ------------------------------------------ |
| [WALKTHROUGH.md](WALKTHROUGH.md)               | this guide                                 |
| [DEPLOYMENT.md](DEPLOYMENT.md)                   | deploying API, web, database and Cloudinary |
| [DECISIONS.md](DECISIONS.md)                   | ADR-001…011 — every significant trade-off  |
| [DIAGRAMS.md](DIAGRAMS.md)                     | ER model + auth/pipeline/AI flow diagrams  |
| [../README.md](../README.md)                   | status table, scripts, env reference, API map |
| [../MOCKED.md](../MOCKED.md)                   | anything not real (goal: empty list)       |
