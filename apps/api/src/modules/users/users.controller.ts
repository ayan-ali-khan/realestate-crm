import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { created, ok } from '../../http/response.js';
import * as usersService from './users.service.js';
import type { CreateUserInput } from './users.schemas.js';
import type { Role } from '../../generated/prisma/client.js';

export const list = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await usersService.listUsers(req));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  created(res, await usersService.createUser(req.body as CreateUserInput));
});

export const updateRole = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const { role } = req.body as { role: Role };
  ok(res, await usersService.updateUserRole(id, role));
});
