# Architecture Decision Records

Short ADRs so every choice in this project can be explained. Newest last.

---

## ADR-001: Monorepo with npm workspaces

- **Status**: Accepted (Phase 0)
- **Context**: The system is two apps (Next.js frontend, Express API) that must agree on
  API contracts, plus shared docs. Options: npm workspaces, pnpm + Turborepo, or two
  separate repositories.
- **Decision**: A single repository with npm workspaces (`apps/*`) and one lockfile.
  Root `package.json` only orchestrates (`dev:api`, `dev:web`, `typecheck`, ...).
- **Consequences**:
  - Zero extra tooling and one lockfile; Vercel and Render both consume npm workspaces fine.
  - No remote build caching (Turborepo) — acceptable at this size.
  - Cross-app type sharing stays simple (import from a shared folder or relative path).
  - The two apps remain separately deployable because each has its own `package.json` and build.

---

## ADR-002: Express 5 with TypeScript in ESM (NodeNext resolution)

- **Status**: Accepted (Phase 0)
- **Context**: Express 5 is stable. The backend must run on Node 20+ in production
  (Render/Railway), and TypeScript must catch module-resolution mistakes at compile time.
- **Decision**:
  - `"type": "module"` in `apps/api/package.json`, `tsconfig` with
    `module/moduleResolution: NodeNext` (relative imports carry explicit `.js` extensions).
  - Express `^5.1.0` instead of 4.
- **Consequences**:
  - Express 5 forwards rejected promises from async handlers to the error middleware
    automatically — safer async route handling by default (we still add the
    `asyncHandler` wrapper from the spec for defense in depth).
  - Path-to-regexp v8: route patterns like bare `*` are no longer allowed; wildcards must
    be named (e.g. `/*splat`). We avoid wildcard routes anyway.
  - ESM is Node's direction and matches what Prisma and the ecosystem generate today.

---

## ADR-003: Bun as the local runtime and package manager

- **Status**: Accepted (Phase 0)
- **Context**: The dev machine has no Node.js and the Node install was declined; Bun 1.4 is
  already available. Production targets (Vercel, Render) run Node 20+.
- **Decision**: Use Bun locally for installs (`bun install`), scripts (`bun run --filter`)
  and the API dev loop (`bun --watch`). No Bun-specific APIs are used in application code:
  `build`/`start` scripts remain pure `tsc` + `node`, so CI and deployment stay Node-based.
- **Consequences**:
  - One lockfile (`bun.lock`) committed; npm/pnpm users would regenerate their own.
  - `tsx` was dropped from the API because its Node loader preload fails under Bun on
    Windows; `bun --watch` runs TypeScript natively and the `dotenv` import keeps working
    under plain Node.
  - Prisma, Vitest and Next.js must be verified under Bun as they land (Phase 1+); if any
    misbehaves, the fallback is installing Node locally — the code itself does not change.

---

## ADR-004: Lead doubles as Customer (`convertedToCustomer` flag)

- **Status**: Accepted (Phase 1)
- **Context**: The spec allows a separate `Customer` model or merged lead/customer records.
  A "customer" in this domain is a lead that reached CLOSED_WON — the identity, contact
  details and full interaction history are the same person.
- **Decision**: Merge. `Lead.convertedToCustomer` (default false) + `convertedAt`; the flag is
  set when a lead is won. No separate Customer table.
- **Consequences**:
  - No duplicated identity data and no sync bugs between two person tables.
  - All history (activities, tasks, site visits, pipeline stages) stays attached to one id —
    a customer-detail page is just a lead-detail page with a "converted" badge.
  - "All customers" is a filtered view (`convertedToCustomer = true`) instead of a join.

---

## ADR-005: Prisma 7 with driver adapters and the generated TypeScript client

- **Status**: Accepted (Phase 1)
- **Context**: Prisma 7 removed the Rust query engine and the `url` property from the
  `datasource` block; connections now go through driver adapters, and CLI connection URLs
  live in `prisma.config.ts`.
- **Decision**:
  - `@prisma/adapter-pg` + `pg` for runtime connections (`new PrismaClient({ adapter })`).
  - `prisma.config.ts` holds `datasource.url` (from `DATABASE_URL`) and the seed command.
  - Generator `prisma-client` emits TypeScript to `apps/api/src/generated/prisma`
    (gitignored; regenerate with `db:generate`).
- **Consequences**:
  - No native engine binaries to download — which is also why Prisma installs cleanly
    under Bun on Windows (Bun skips postinstall scripts).
  - The client is generated TS compiled with the app: typecheck covers it (strict mode).
  - Migration SQL is authored offline via `prisma migrate diff --from-empty --to-schema`;
    `migrate dev/apply` runs once the cloud `DATABASE_URL` is provided.

---

## ADR-006: Schema shape details

- **Status**: Accepted (Phase 1)
- **Decisions** (each is a deliberate trade-off):
  - **No unique constraint on `Lead.email`** (and email is nullable): walk-in leads may only
    give a phone number, and the same person can inquire twice from different sources.
    Duplicate detection is a search problem, not a constraint; a constraint would reject
    legitimate data entry.
  - **Soft delete via `Lead.deletedAt`**: activities, tasks and visits keep referential
    integrity; list queries filter `deletedAt IS NULL`.
  - **`Task.isOverdue` flag** (instead of an OVERDUE status): a node-cron job (Phase 4)
    flips the flag, so completing an overdue task does not erase the fact that it was late.
  - **Integer prices in whole currency units**: floats are unsafe for money; cents would
    add conversion noise with no real-estate benefit. `Int` covers up to ~$2.1B.
  - **Indexes** on every FK plus the filter/search columns used by the spec (stage, source,
    priority, assignedTo, createdAt, deletedAt, city, status, price, type, dueAt).

---

## ADR-007: JWT auth — `jose`, httpOnly cookies, refresh-token rotation

- **Status**: Accepted (Phase 2)
- **Context**: The spec requires JWT access + refresh tokens in httpOnly cookies,
  bcrypt hashing, and role-based access.
- **Decision**:
  - **`jose`** (IETF JOSE working group, ESM-native) instead of `jsonwebtoken`
    (CJS-only, needs interop shims in an ESM codebase; `jose` also runs unchanged in
    Edge runtimes if the frontend ever verifies tokens).
  - **Two cookies**: access (`15m`, path `/`) and refresh (`7d`, path `/api/v1/auth`),
    both `httpOnly`, `Secure` in production, `SameSite=Lax` in dev/test and
    `SameSite=None` in production so split-domain deploys (web on one host, API
    on another) still receive the session. The CSRF mitigation is allowlisted
    CORS plus the JSON body: a cross-origin JSON write forces a preflight that
    only `CORS_ORIGINS` passes — form posts can't carry the required body.
  - **Rotation + server-side revocation**: refresh JWTs carry a `jti`; the DB stores only
    its SHA-256 hash (`RefreshToken` model, migration 0002). Refreshing revokes the
    presented token and issues a new pair — replaying an old token returns 401 and is
    detectable. Logout revokes server-side and clears cookies.
- **Consequences**:
  - A leaked database contains no replayable tokens (hashes only).
  - One extra DB write per login/refresh — negligible at this scale.
  - Access tokens stay stateless (no per-request DB hit); revoking access relies on the
    15-minute TTL (accepted trade-off, standard for short-lived access tokens).

---

## ADR-008: Integration tests against an isolated `*_test` database

- **Status**: Accepted (Phase 2)
- **Context**: The spec requires Supertest integration tests for auth (and later lead CRUD
  and stage changes). Running them against dev data would corrupt the demo dataset.
- **Decision**: The suite runs against `<dbname>_test` on the same Neon server.
  `tests/global-setup.ts` creates the database if missing (42P04 tolerated), applies
  migrations, and runs the seed once per run; workers point `DATABASE_URL` at it via
  `tests/setup.ts` before any app module loads. Vitest runs with `fileParallelism: false`
  (single shared DB).
- **Consequences**:
  - The full HTTP stack (cookies, JWTs, Prisma, real Postgres) is exercised end to end;
    nothing is mocked.
  - Tests are slower than unit-only tests (~70s cold) but cover what actually ships.
  - Vitest was verified to run under Bun on Windows (16/16 passing), keeping the
    Bun-only toolchain promise from ADR-003.

---

## ADR-009: Pipeline mechanics — dedicated verbs, honest timelines, assignment-scoped agents

- **Status**: Accepted (Phase 3)
- **Context**: Leads need stage transitions, assignment, an activity timeline and tasks.
  Two design questions matter for the UI and the Phase 10 AI: what counts as a "lead
  update", and who can see what.
- **Decision**:
  - **Stage and assignment are not PATCH fields.** `PATCH /leads/:id` is a pure field
    update (rejects empty bodies); stage moves go through `POST /:id/stage` and assignment
    through `POST /:id/assign`. Every pipeline event therefore maps to one explicit,
    audit-visible endpoint instead of a diff.
  - **A small explicit stage machine** (`leads.pipeline.ts`): forward moves may skip
    stages, `CLOSED_WON` is terminal, `CLOSED_LOST` revives only to `NEW_LEAD`. Invalid
    moves return 409 with the allowed targets in the message.
  - **The timeline cannot be lied to**: `STAGE_CHANGE` is written transactionally with
    the stage update; clients may only log `CALL`/`EMAIL`/`NOTE` (schema rejects the
    system types; `AI_ACTION` is reserved for Phase 10).
  - **Agent visibility = assignment**: agents see leads assigned to them, their leads'
    timelines, and only their own tasks; managers/admins see everything. Ids outside your
    scope return 404 (unprobeable), not 403.
  - **`Task.isOverdue` is repaired on read** until the Phase 4 cron exists: every list
    call syncs drifted flags first, so the flag is never stale regardless of job uptime.
- **Consequences**:
  - Conversion stays a derived event (ADR-004): reaching `CLOSED_WON` flips
    `convertedToCustomer` once, in the same transaction as the stage change.
  - Soft-deleted leads keep activities/tasks referentially intact and are hidden by
    default, with `?includeDeleted=true` for audits.
  - The UI (Phase 5+) gets dedicated actions for stage/assign, which reads better as
    buttons and dropdowns than as generic saves anyway.

---

## ADR-010: Background jobs — in-process node-cron, two maintenance jobs

- **Status**: Accepted (Phase 4)
- **Context**: Two maintenance tasks have no natural home in a request path:
  `Task.isOverdue` drifts whenever time passes with no write (the flag was
  "repaired on read", costing every list call two UPDATE round trips against a
  remote DB), and refresh-token rotation writes one `RefreshToken` row per
  login/refresh with nothing ever deleting them — unbounded growth.
- **Decision**:
  - **In-process `node-cron`** (`src/jobs/scheduler.ts`) started from
    `index.ts`, stopped on SIGTERM/SIGINT. A separate worker process would be
    the next step only if jobs outgrow the request process (heavy compute,
    multiple API instances needing leader election). Both jobs are idempotent
    `updateMany`/`deleteMany` sweeps, so multi-instance overlap would be
    harmless anyway.
  - **Two jobs**: `overdue-sync` (default every minute; flips `isOverdue` for
    PENDING past-due tasks and clears it otherwise) and `token-prune` (default
    nightly 03:17; deletes refresh tokens past `expiresAt`). Schedules are env
    vars (`OVERDUE_SYNC_CRON`, `TOKEN_PRUNE_CRON`); `CRON_ENABLED=false`
    disables jobs (the test suite sets this so no suite ever races a tick).
  - **Fail-fast validation, fail-safe execution**: cron expressions are
    validated at boot (a typo in env crashes startup instead of silently
    disabling a job); each run is wrapped in try/catch + `noOverlap`, so a
    failing or slow run logs and retries next tick without crashing the API or
    stacking runs.
  - **Startup catch-up run**: both jobs run once at boot, repairing drift
    accumulated while no process was running (deploys, local restarts).
  - **The read-path repair is gone**: writes still compute `isOverdue` at
    create/update time (immediate UX), and the every-minute sweep bounds
    staleness to one tick. List queries no longer pay two extra UPDATEs per
    call. A `RefreshToken(expiresAt)` index (migration
    `20261020140000`) makes the prune sweep a range scan.
  - **Prune deletes only expired rows**: a revoked-but-unexpired token must
    survive — it is the replay-detection signal from ADR-007 (the refresh
    endpoint distinguishes "revoked" from "never existed"). Expired rows can
    no longer authenticate anything, so deleting them loses nothing.

---

## ADR-011: AI features — real model calls behind a provider-agnostic client

- **Status**: Accepted (Phase 6)
- **Context**: The spec demands *real* AI (lead scoring, follow-up drafting,
  interaction summaries, task suggestions) under the rule that anything not
  real must appear in MOCKED.md — whose goal is an empty list. The provider is
  a business decision (keys, cost, region) the code should not be hard-coded
  around, and the API runs on Bun locally but must deploy on plain Node 20.
- **Decision**:
  - **One fetch client, any OpenAI-compatible endpoint** (`ai.provider.ts`):
    a single POST to `${AI_BASE_URL}/chat/completions` with
    `Authorization: Bearer ${AI_API_KEY}`. OpenAI is the default base URL and
    model, but Groq, OpenRouter, DeepSeek and Gemini's compat layer work by
    changing two env vars — no code change, no SDK per provider.
  - **No SDK**: the contract is one HTTP call plus one JSON body; the WHATWG
    `fetch` both runtimes ship is enough, and it keeps the deploy
    dependency-free.
  - **Strict structured output with a compat fallback**: requests ask for
    `response_format: json_schema` (strict); providers that reject it get one
    retry without it, and *every* answer is zod-validated either way. An
    unparseable or invalid answer is a 502 `EXTERNAL_SERVICE_ERROR` — never a
    silently wrong score. Scores and due dates are clamped, not rejected.
  - **Config-gated, not feature-gated**: with `AI_API_KEY` unset every AI
    endpoint answers 503 with a "set AI_API_KEY" message while the rest of the
    CRM works normally; timeouts (default 30s) answer 504, upstream failures
    502. The test suite deletes the key so its contract tests are
    deterministic and can never spend money.
  - **Scoped like the lead, audited in the timeline**: `findAccessibleLead`
    runs before any AI check (probing another agent's lead answers 404, not a
    config error). Every feature writes an `AI_ACTION` activity as the
    requesting user (model + payload in metadata), and scoring persists
    `Lead.aiScore/aiScoreReason` in the same transaction as its activity —
    header chip and timeline can never disagree.
  - **Suggestions are suggestions**: the task suggester never writes tasks —
    accepting one goes through the normal `POST /tasks` endpoint, so the human
    stays the decision point.
- **Consequences**:
  - Switching providers is an env change; a provider with a different wire
    format is one new function behind the same `chatJson` interface.
  - Without a key the features honestly report 503 (the UI surfaces the
    message) — no heuristic fallback that would violate the spec's "real AI"
    rule.
  - Structured-output quality varies by provider; the zod gate makes a weak
    provider fail loudly at the boundary instead of corrupting CRM records.
- **Consequences**:
  - One process to deploy; no queue/broker infrastructure at this scale.
  - `isOverdue` can be up to one tick stale (≤1 min by default) for
    time-driven drift — writes are always immediate, so anything the user just
    touched is correct.
  - Adding a job = one entry in `jobs()` + (optionally) an env schedule; the
    scheduler owns validation, logging, overlap and shutdown uniformly.
