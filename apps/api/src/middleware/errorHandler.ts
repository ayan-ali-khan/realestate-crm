// Centralized error handler: the single place that turns any thrown/rejected
// value into the { success, data, error } envelope. Stack traces and internals
// never leave the server in production; they are logged instead.
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { Envelope } from '../http/response.js';

const prismaErrorCodes: Record<string, { status: number; code: string; message: string }> = {
  P2002: { status: 409, code: 'CONFLICT', message: 'Resource already exists' },
  P2025: { status: 404, code: 'NOT_FOUND', message: 'Resource not found' },
  P2003: { status: 400, code: 'VALIDATION_ERROR', message: 'Related resource does not exist' },
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;

  if (err instanceof ZodError) {
    const body: Envelope<null> = {
      success: false,
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues,
      },
    };
    res.status(400).json(body);
    return;
  }

  if (err instanceof AppError) {
    const body: Envelope<null> = {
      success: false,
      data: null,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details === undefined ? {} : { details: err.details }),
      },
    };
    res.status(err.status).json(body);
    return;
  }

  const prismaMapped =
    typeof err?.code === 'string' && prismaErrorCodes[err.code] ? prismaErrorCodes[err.code] : null;
  if (prismaMapped) {
    const body: Envelope<null> = {
      success: false,
      data: null,
      error: { code: prismaMapped.code, message: prismaMapped.message },
    };
    res.status(prismaMapped.status).json(body);
    return;
  }

  logger.error({ err, req: { method: req.method, url: req.url } }, 'Unhandled request error');
  const body: Envelope<null> = {
    success: false,
    data: null,
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  };
  res.status(500).json(body);
};
