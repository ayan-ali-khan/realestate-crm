import { pinoHttp } from 'pino-http';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export const requestLogger = pinoHttp({
  logger,
  autoLogging:
    env.NODE_ENV === 'test'
      ? false
      : { ignore: (req) => req.url === '/health' || req.url?.startsWith('/health?') === true },
});
