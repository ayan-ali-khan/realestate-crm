// Express Request augmentation: req.auth is set by requireAuth;
// validatedQuery/validatedParams are set by the validate() middleware.
import type { Role } from '../generated/prisma/client.js';

export interface AuthPayload {
  sub: string;
  role: Role;
}

declare module 'express' {
  interface Request {
    auth?: AuthPayload;
    validatedQuery?: unknown;
    validatedParams?: unknown;
  }
}
