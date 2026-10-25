// Zod request validation: parse body/query/params before the controller runs.
// Controllers therefore receive already-validated, already-typed input.
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

type Validated<S extends Schemas> = {
  [K in keyof S]: S[K] extends ZodType ? ReturnType<S[K]['parse']> : never;
};

export function validate<S extends Schemas>(schemas: S): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        (req as Request & { body: unknown }).body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        (req as Request & { validatedQuery: unknown }).validatedQuery = schemas.query.parse(
          req.query,
        );
      }
      if (schemas.params) {
        (req as Request & { validatedParams: unknown }).validatedParams = schemas.params.parse(
          req.params,
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export type ValidatedRequest<S extends Schemas> = Request & Validated<S>;
