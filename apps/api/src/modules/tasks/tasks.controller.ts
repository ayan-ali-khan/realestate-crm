import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authOf } from '../../middleware/authenticate.js';
import { created, ok } from '../../http/response.js';
import * as tasksService from './tasks.service.js';
import type { CreateTaskInput, UpdateTaskInput } from './tasks.schemas.js';

export const list = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await tasksService.listTasks(req, authOf(req)));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  created(res, await tasksService.createTask(req.body as CreateTaskInput, authOf(req)));
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  ok(res, await tasksService.updateTask(id, req.body as UpdateTaskInput, authOf(req)));
});
