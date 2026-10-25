import { Router } from 'express';
import * as usersController from './users.controller.js';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/authenticate.js';
import { createUserSchema, listUsersQuerySchema, updateUserRoleSchema } from './users.schemas.js';

export const usersRouter = Router();

// Listing is useful to managers for lead assignment; mutations are ADMIN-only.
usersRouter.get(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  validate({ query: listUsersQuerySchema }),
  usersController.list,
);
usersRouter.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: createUserSchema }),
  usersController.create,
);
usersRouter.patch(
  '/:id/role',
  requireRole('ADMIN'),
  validate({ body: updateUserRoleSchema }),
  usersController.updateRole,
);
