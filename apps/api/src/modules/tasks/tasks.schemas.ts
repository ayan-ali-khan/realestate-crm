import { z } from 'zod';
import { TaskStatus } from '../../generated/prisma/client.js';

// Spec list/filter paths: assignee, status, overdue, due-date range + lead scoping.
export const listTasksQuerySchema = z.object({
  status: z.enum(TaskStatus).optional(),
  assigneeId: z.string().min(1).optional(),
  leadId: z.string().min(1).optional(),
  overdue: z.stringbool().optional(),
  dueFrom: z.coerce.date().optional(),
  dueTo: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export const createTaskSchema = z.object({
  leadId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  dueAt: z.coerce.date(),
  // Omitted = self; assigning to someone else is manager/admin territory.
  assigneeId: z.string().min(1).optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    dueAt: z.coerce.date().optional(),
    status: z.enum(TaskStatus).optional(),
    // Reassignment is manager/admin only (enforced in the service).
    assigneeId: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.dueAt !== undefined ||
      v.status !== undefined ||
      v.assigneeId !== undefined,
    { message: 'At least one field to update is required' },
  );

export const taskIdParamSchema = z.object({ id: z.string().min(1) });

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
