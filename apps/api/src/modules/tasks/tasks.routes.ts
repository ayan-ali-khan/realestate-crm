import { Router } from 'express';
import * as tasksController from './tasks.controller.js';
import { validate } from '../../middleware/validate.js';
import {
  createTaskSchema,
  listTasksQuerySchema,
  taskIdParamSchema,
  updateTaskSchema,
} from './tasks.schemas.js';

export const tasksRouter = Router();

tasksRouter.get('/', validate({ query: listTasksQuerySchema }), tasksController.list);
tasksRouter.post('/', validate({ body: createTaskSchema }), tasksController.create);
tasksRouter.patch(
  '/:id',
  validate({ params: taskIdParamSchema, body: updateTaskSchema }),
  tasksController.update,
);
