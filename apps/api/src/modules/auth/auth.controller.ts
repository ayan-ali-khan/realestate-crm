// Thin controllers: parse transport concerns, delegate to the service, shape
// the response. No business logic here.
import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { created, ok } from '../../http/response.js';
import { REFRESH_COOKIE } from '../../lib/tokens.js';
import * as authService from './auth.service.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.register(req.body as RegisterInput, res);
  created(res, user);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.login(req.body as LoginInput, res);
  ok(res, user);
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  await authService.refresh(req.cookies?.[REFRESH_COOKIE], res);
  ok(res, { refreshed: true });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  await authService.logout(req.cookies?.[REFRESH_COOKIE], res);
  ok(res, { loggedOut: true });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth) throw new Error('requireAuth middleware missing');
  ok(res, await authService.me(req.auth.sub));
});
