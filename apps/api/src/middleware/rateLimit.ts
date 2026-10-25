// Rate limiting: a generous global bucket, a strict bucket on auth endpoints
// (brute-force mitigation), and a strict AI bucket (cost control) wired in
// Phase 10.
import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';

const standardHeaders = { standardHeaders: 'draft-8' as const, legacyHeaders: false };

export const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: env.RATE_LIMIT_MAX,
  ...standardHeaders,
  message: {
    success: false,
    data: null,
    error: { code: 'RATE_LIMITED', message: 'Too many requests' },
  },
});

export const authLimiter = rateLimit({
  windowMs: 60_000,
  max: env.AUTH_RATE_LIMIT_MAX,
  ...standardHeaders,
  message: {
    success: false,
    data: null,
    error: { code: 'RATE_LIMITED', message: 'Too many auth attempts' },
  },
});

export const aiLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  ...standardHeaders,
  message: {
    success: false,
    data: null,
    error: { code: 'RATE_LIMITED', message: 'Too many AI requests' },
  },
});
