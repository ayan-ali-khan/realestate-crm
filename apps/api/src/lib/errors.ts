// Typed application errors. Controllers/services throw these; the centralized
// error handler turns them into the { success, data, error } envelope.
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(409, 'CONFLICT', message);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests, please try again later') {
    super(429, 'RATE_LIMITED', message);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message = 'External service unavailable', details?: unknown) {
    super(502, 'EXTERNAL_SERVICE_ERROR', message, details);
  }
}

// External-call lifecycle, in status-code order: 503 = dependency not
// configured (AI_API_KEY unset), 502 = upstream answered but we could not use
// the answer, 504 = upstream too slow. All share EXTERNAL_SERVICE_ERROR so
// clients branch on status, not on a zoo of codes.
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Dependency not configured', details?: unknown) {
    super(503, 'EXTERNAL_SERVICE_ERROR', message, details);
  }
}

export class GatewayTimeoutError extends AppError {
  constructor(message = 'External service timed out', details?: unknown) {
    super(504, 'EXTERNAL_SERVICE_ERROR', message, details);
  }
}
