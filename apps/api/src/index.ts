import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { buildApp } from './app.js';
import { startJobs } from './jobs/scheduler.js';

const app = buildApp();

const server = app.listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

const jobs = startJobs();

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info(`${signal} received, shutting down`);
    void jobs.stop().finally(() => {
      server.close(() => {
        void prisma.$disconnect().finally(() => process.exit(0));
      });
    });
  });
}
