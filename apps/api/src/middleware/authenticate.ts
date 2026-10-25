// Authentication + RBAC. The access token is a short-lived JWT in an httpOnly
// cookie; requireAuth verifies it and attaches req.auth, requireRole enforces
// the role hierarchy (ADMIN > MANAGER > AGENT is a policy choice documented in
// the ADRs — enforced per-route, not by magic).
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { verifyAccessToken, ACCESS_COOKIE } from '../lib/tokens.js';
import type { TokenPayload } from '../lib/tokens.js';
import type { Role } from '../generated/prisma/client.js';

// req.auth is declared in src/types/express.d.ts.
export const requireAuth: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedError();
    req.auth = await verifyAccessToken(token);
    next();
  } catch (err) {
    next(
      err instanceof ForbiddenError || err instanceof UnauthorizedError
        ? err
        : new UnauthorizedError(),
    );
  }
};

// For controllers on routes already guarded by requireAuth: unwraps the
// payload without re-verification (and without non-null assertions everywhere).
export function authOf(req: Request): TokenPayload {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(new UnauthorizedError());
    if (!roles.includes(req.auth.role)) return next(new ForbiddenError());
    next();
  };
}
