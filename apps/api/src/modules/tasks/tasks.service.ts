// Tasks service: follow-up work items attached to leads. Access model
// (ADR-007): agents see and edit only tasks assigned to them; managers/admins
// see everything and may reassign. isOverdue is a materialized view of
// (PENDING && dueAt < now): writes compute it at create/update time and the
// Phase 4 cron job (src/jobs/overdue.sync.ts) repairs time-driven drift on a
// schedule, so list queries never pay for it (ADR-010).
import type { Request } from 'express';
import { prisma } from '../../lib/prisma.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { paginated, parsePagination } from '../../http/response.js';
import { findAccessibleLead } from '../leads/leads.service.js';
import type { TokenPayload } from '../../lib/tokens.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from './tasks.schemas.js';

const SAFE_USER_SELECT = { id: true, name: true, email: true, role: true } as const;

const TASK_INCLUDE = {
  assignee: { select: SAFE_USER_SELECT },
  lead: { select: { id: true, name: true, stage: true, priority: true } },
} satisfies Prisma.TaskInclude;

const isManager = (auth: TokenPayload): boolean => auth.role !== 'AGENT';

export async function listTasks(req: Request, auth: TokenPayload) {
  const q = req.validatedQuery as ListTasksQuery;
  const { page, pageSize, skip, take } = parsePagination(req);

  const where: Prisma.TaskWhereInput = {
    // Agents only ever see their own task list; managers/admins filter further.
    assigneeId: isManager(auth) ? q.assigneeId : auth.sub,
    status: q.status,
    leadId: q.leadId,
    isOverdue: q.overdue,
    dueAt: { gte: q.dueFrom, lte: q.dueTo },
  };

  const [total, data] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: [{ dueAt: 'asc' }, { id: 'desc' }],
      skip,
      take,
      include: TASK_INCLUDE,
    }),
  ]);
  return paginated(data, { page, pageSize, total });
}

export async function createTask(input: CreateTaskInput, auth: TokenPayload) {
  await findAccessibleLead(input.leadId, auth);
  const assigneeId = input.assigneeId ?? auth.sub;
  if (assigneeId !== auth.sub && !isManager(auth)) {
    throw new ForbiddenError('Agents can only create tasks for themselves');
  }
  const assignee = await prisma.user.findUnique({
    where: { id: assigneeId },
    select: { id: true },
  });
  if (!assignee) throw new ValidationError('assigneeId does not reference an existing user');

  return prisma.task.create({
    data: {
      leadId: input.leadId,
      title: input.title,
      dueAt: input.dueAt,
      assigneeId,
      createdBy: 'USER',
      // Overdue at birth counts: a past-due task created now is overdue now.
      isOverdue: input.dueAt < new Date(),
    },
    include: TASK_INCLUDE,
  });
}

export async function updateTask(id: string, input: UpdateTaskInput, auth: TokenPayload) {
  const task = await prisma.task.findUnique({ where: { id } });
  // Own task or manager/admin; strangers get 404 so ids stay unprobeable.
  if (!task || (!isManager(auth) && task.assigneeId !== auth.sub)) {
    throw new NotFoundError('Task not found');
  }
  if (input.assigneeId !== undefined && !isManager(auth)) {
    throw new ForbiddenError('Only managers and admins can reassign tasks');
  }
  if (input.assigneeId !== undefined) {
    const assignee = await prisma.user.findUnique({
      where: { id: input.assigneeId },
      select: { id: true },
    });
    if (!assignee) throw new ValidationError('assigneeId does not reference an existing user');
  }

  const dueAt = input.dueAt ?? task.dueAt;
  const status = input.status ?? task.status;
  return prisma.task.update({
    where: { id },
    data: { ...input, isOverdue: status === 'PENDING' && dueAt < new Date() },
    include: TASK_INCLUDE,
  });
}
