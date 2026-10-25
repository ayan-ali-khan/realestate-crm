// User management service (ADMIN). Managers may list users for lead assignment.
import { prisma } from '../../lib/prisma.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { paginated, parsePagination } from '../../http/response.js';
import type { Request } from 'express';
import type { CreateUserInput, ListUsersQuery } from './users.schemas.js';
import type { Role } from '../../generated/prisma/client.js';

const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function listUsers(req: Request) {
  const { role } = req.validatedQuery as ListUsersQuery;
  const { page, pageSize, skip, take } = parsePagination(req);
  const where = role ? { role: role as Role } : {};
  const [total, data] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: SAFE_USER_SELECT,
    }),
  ]);
  return paginated(data, { page, pageSize, total });
}

export async function createUser(input: CreateUserInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ConflictError('An account with this email already exists');
  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
    },
    select: SAFE_USER_SELECT,
  });
}

export async function updateUserRole(id: string, role: Role) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new NotFoundError('User not found');
  return prisma.user.update({ where: { id }, data: { role }, select: SAFE_USER_SELECT });
}
