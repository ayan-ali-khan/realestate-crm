import { z } from 'zod';
import { Role } from '../../generated/prisma/client.js';

export const listUsersQuerySchema = z.object({
  role: z.enum(Role).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export const createUserSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.email(),
  password: z.string().min(8).max(72),
  role: z.enum(Role),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(Role),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
