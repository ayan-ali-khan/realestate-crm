import pino from 'pino';
import { env } from '../config/env.js';

// Credentials must never reach the logs (OWASP / spec: "no sensitive data in logs").
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
    ],
    censor: '[REDACTED]',
  },
});
