// Typed, validated environment configuration.
// Junk values are dropped before parsing: this machine (and some PaaS hosts)
// export e.g. `PORT=""` or `PORT="0"` (Phase 0 bug, and again in Phase 4 when
// the shell exported PORT=0 which Bun prefers over .env). Both mean "unset"
// here — an ephemeral port would make the advertised URL meaningless.
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url(),
  // Comma-separated allowlist; credentials allowed (cookies) so it must be explicit.
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  ACCESS_TOKEN_SECRET: z.string().min(32),
  REFRESH_TOKEN_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('7d'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW: z.string().default('1m'),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  // --- AI features (Phase 6) ------------------------------------------------
  // The AI layer speaks to any OpenAI-compatible chat-completions endpoint
  // (ADR-011): unset key = features answer 503 AI-off, everything else in the
  // CRM keeps working. Base URL + model pick the provider (OpenAI default;
  // Groq/OpenRouter/Gemini-compat all work by changing these two).
  AI_API_KEY: z.string().min(1).optional(),
  AI_BASE_URL: z.url().default('https://api.openai.com/v1'),
  AI_MODEL: z.string().min(1).default('gpt-6-luna'),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  // --- Property image uploads (Cloudinary) --------------------------------
  // Same contract as the AI key: all three unset = the image endpoints answer
  // 503 EXTERNAL_SERVICE_ERROR (with a message naming these vars) while the
  // rest of the CRM — including creating properties — keeps working.
  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),

  // Background maintenance jobs (Phase 4). Disabled in tests so the suite
  // never races a scheduled run; expressions are cron (node-cron syntax).
  CRON_ENABLED: z.stringbool().default(true),
  // Task.isOverdue is a materialized flag; this job is its source of truth.
  OVERDUE_SYNC_CRON: z.string().default('* * * * *'),
  // Refresh tokens accumulate one row per login — nightly pruning bounds the table.
  TOKEN_PRUNE_CRON: z.string().default('17 3 * * *'),
});

const isJunkPort = (key: string, value: string | undefined): boolean =>
  key === 'PORT' && (value === '0' || value === '0000');

const stripEmpty = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));

const sanitize = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([k, v]) => !isJunkPort(k, v)));

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(sanitize(stripEmpty(process.env)));
