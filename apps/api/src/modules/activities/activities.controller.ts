import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authOf } from '../../middleware/authenticate.js';
import { created, ok } from '../../http/response.js';
import * as activitiesService from './activities.service.js';
import type { CreateActivityInput } from './activities.schemas.js';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { id: leadId } = req.params as { id: string };
  ok(res, await activitiesService.listActivities(leadId, req, authOf(req)));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const { id: leadId } = req.params as { id: string };
  created(
    res,
    await activitiesService.createActivity(leadId, req.body as CreateActivityInput, authOf(req)),
  );
});
