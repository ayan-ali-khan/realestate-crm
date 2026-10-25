import { Router } from 'express';
import * as activitiesController from './activities.controller.js';
import { validate } from '../../middleware/validate.js';
import { createActivitySchema, listActivitiesQuerySchema } from './activities.schemas.js';

// Mounted under leadsRouter at /:id/activities; mergeParams re-exposes :id.
export const leadActivitiesRouter = Router({ mergeParams: true });

leadActivitiesRouter.get(
  '/',
  validate({ query: listActivitiesQuerySchema }),
  activitiesController.list,
);
leadActivitiesRouter.post(
  '/',
  validate({ body: createActivitySchema }),
  activitiesController.create,
);
