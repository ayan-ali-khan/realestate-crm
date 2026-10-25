// Express app assembly. buildApp() is exported so tests can mount the exact
// same app (via supertest) without opening a port.
import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { NotFoundError } from './lib/errors.js';
import { ok } from './http/response.js';
import { asyncHandler } from './middleware/asyncHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { globalLimiter, authLimiter } from './middleware/rateLimit.js';
import { requireAuth } from './middleware/authenticate.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { leadsRouter } from './modules/leads/leads.routes.js';
import { tasksRouter } from './modules/tasks/tasks.routes.js';
import { propertiesRouter } from './modules/properties/properties.routes.js';

export function buildApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  // One proxy in front (Render/ Railway); needed for correct client IPs in rate limiting.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS.split(','), credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '100kb' }));
  app.use(requestLogger);
  app.use(globalLimiter);

  app.get(
    '/health',
    asyncHandler(async (req, res) => {
      const deep = req.query.deep !== undefined;
      if (deep) await prisma.$queryRaw`SELECT 1`;
      ok(res, {
        status: 'ok',
        uptimeSeconds: Math.round(process.uptime()),
        db: deep ? 'ok' : 'unchecked',
      });
    }),
  );

  app.use('/api/v1/auth', authLimiter, authRouter);
  app.use('/api/v1/users', requireAuth, usersRouter);
  app.use('/api/v1/leads', requireAuth, leadsRouter);
  app.use('/api/v1/tasks', requireAuth, tasksRouter);
  app.use('/api/v1/properties', requireAuth, propertiesRouter);

  app.use((_req, _res, next) => next(new NotFoundError('Route not found')));
  app.use(errorHandler);
  return app;
}
