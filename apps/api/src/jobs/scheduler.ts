// Phase 4: background job scheduler (ADR-010). Registers the maintenance jobs
// with node-cron and owns their lifecycle:
// - Cron expressions come from env and are validated at startup: a typo fails
//   boot loudly instead of silently disabling a job.
// - Each run is wrapped in try/catch — a failing job logs and retries on the
//   next tick; it can never crash the API process.
// - noOverlap: a slow run is skipped, not stacked. unref: cron timers never
//   hold the process open (clean shutdown, fast test runs).
// - A catch-up run at startup repairs drift accumulated while the process was
//   down (e.g. a deploy), since both jobs are idempotent.
import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { syncOverdueFlags } from './overdue.sync.js';
import { pruneExpiredRefreshTokens } from './token-prune.js';

// Route node-cron's own diagnostics (missed ticks, overlaps) through pino so
// they honour the same level config and secret redaction as everything else.
cron.setLogger({
  info: (message) => logger.info(message),
  warn: (message) => logger.warn(message),
  error: (message, err) => logger.error({ err }, String(message)),
  debug: (message) => logger.debug(message),
});

export interface JobConfig {
  overdueSync: string;
  tokenPrune: string;
}

const envConfig = (): JobConfig => ({
  overdueSync: env.OVERDUE_SYNC_CRON,
  tokenPrune: env.TOKEN_PRUNE_CRON,
});

interface JobSpec {
  name: string;
  schedule: string;
  run: () => Promise<unknown>;
}

// The one place a job run can throw. Logged with the job name so a failing
// schedule is diagnosable from the log alone; the next tick retries.
async function runSafely(spec: JobSpec): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await spec.run();
    logger.debug({ job: spec.name, ms: Date.now() - startedAt, result }, 'job run complete');
  } catch (err) {
    logger.error({ err, job: spec.name, ms: Date.now() - startedAt }, 'job run failed');
  }
}

const jobs = (config: JobConfig): JobSpec[] => [
  { name: 'overdue-sync', schedule: config.overdueSync, run: () => syncOverdueFlags() },
  { name: 'token-prune', schedule: config.tokenPrune, run: () => pruneExpiredRefreshTokens() },
];

export interface JobsHandle {
  stop: () => Promise<void>;
}

export function startJobs(overrides?: {
  enabled?: boolean;
  config?: Partial<JobConfig>;
}): JobsHandle {
  const enabled = overrides?.enabled ?? env.CRON_ENABLED;
  if (!enabled) {
    logger.info('background jobs disabled (CRON_ENABLED=false)');
    return { stop: async () => {} };
  }

  const config = { ...envConfig(), ...overrides?.config };
  const tasks: ScheduledTask[] = [];

  for (const spec of jobs(config)) {
    if (!cron.validate(spec.schedule)) {
      // Fail fast: a bad expression in env must not silently disable a job.
      throw new Error(
        `Invalid cron expression for job "${spec.name}": ${JSON.stringify(spec.schedule)}`,
      );
    }
    tasks.push(
      cron.schedule(spec.schedule, () => runSafely(spec), {
        name: spec.name,
        noOverlap: true,
        unref: true,
      }),
    );
    logger.info({ job: spec.name, schedule: spec.schedule }, 'background job scheduled');
  }

  // Catch-up: repair anything that drifted while no process was running.
  // Idempotent by construction (updateMany/deleteMany on absolute state).
  void Promise.all(jobs(config).map((spec) => runSafely(spec)));

  return {
    stop: async () => {
      await Promise.all(tasks.map((task) => task.stop()));
      logger.info('background jobs stopped');
    },
  };
}
