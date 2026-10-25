import { Router } from 'express';
import * as aiController from './ai.controller.js';
import { validate } from '../../middleware/validate.js';
import { aiAssistSchema } from './ai.schemas.js';

// Mounted under leadsRouter at /:id/ai; mergeParams re-exposes :id (the same
// pattern as the activities sub-resource). The id param is validated at the
// mount point, so each route only validates its optional body.
export const aiRouter = Router({ mergeParams: true });

aiRouter.post('/score', validate({ body: aiAssistSchema.optional() }), aiController.score);
aiRouter.post('/draft-email', validate({ body: aiAssistSchema.optional() }), aiController.draftEmail);
aiRouter.post('/summarize', validate({ body: aiAssistSchema.optional() }), aiController.summarize);
aiRouter.post(
  '/suggest-tasks',
  validate({ body: aiAssistSchema.optional() }),
  aiController.suggestTasks,
);
