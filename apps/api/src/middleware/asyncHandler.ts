import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Wraps async handlers so rejections reach the error middleware. Express 5
// also forwards async rejections natively; we keep the wrapper because the
// spec requires it and it makes the contract explicit.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}
