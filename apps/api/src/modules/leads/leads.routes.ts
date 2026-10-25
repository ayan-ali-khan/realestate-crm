import { Router } from 'express';
import * as leadsController from './leads.controller.js';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/authenticate.js';
import { leadActivitiesRouter } from '../activities/activities.routes.js';
import { aiRouter } from '../ai/ai.routes.js';
import {
  addInquirySchema,
  assignLeadSchema,
  changeStageSchema,
  createLeadSchema,
  idParamSchema,
  listLeadsQuerySchema,
  scheduleVisitSchema,
  updateLeadSchema,
  updateVisitSchema,
  visitParamsSchema,
} from './leads.schemas.js';

export const leadsRouter = Router();

leadsRouter.get('/', validate({ query: listLeadsQuerySchema }), leadsController.list);
leadsRouter.post('/', validate({ body: createLeadSchema }), leadsController.create);
leadsRouter.get('/:id', validate({ params: idParamSchema }), leadsController.get);
leadsRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateLeadSchema }),
  leadsController.update,
);
// Stage/assignment/deletion are separate verbs — PATCH stays a pure field update.
leadsRouter.delete(
  '/:id',
  validate({ params: idParamSchema }),
  requireRole('MANAGER', 'ADMIN'),
  leadsController.remove,
);
leadsRouter.post(
  '/:id/stage',
  validate({ params: idParamSchema, body: changeStageSchema }),
  leadsController.changeStage,
);
leadsRouter.post(
  '/:id/assign',
  validate({ params: idParamSchema, body: assignLeadSchema }),
  requireRole('MANAGER', 'ADMIN'),
  leadsController.assign,
);
leadsRouter.post(
  '/:id/inquiries',
  validate({ params: idParamSchema, body: addInquirySchema }),
  leadsController.addInquiry,
);

// Site visits: schedule (POST) + lifecycle status (PATCH). Dedicated verbs,
// same shape as stage/assign — PATCH /:id stays a pure field update.
leadsRouter.post(
  '/:id/visits',
  validate({ params: idParamSchema, body: scheduleVisitSchema }),
  leadsController.scheduleVisit,
);
leadsRouter.patch(
  '/:id/visits/:visitId',
  validate({ params: visitParamsSchema, body: updateVisitSchema }),
  leadsController.updateVisit,
);

// Nested sub-resource: /api/v1/leads/:id/activities (mergeParams re-exposes :id).
leadsRouter.use('/:id/activities', validate({ params: idParamSchema }), leadActivitiesRouter);

// AI features (Phase 6): /api/v1/leads/:id/ai/* — same scoping as the lead
// itself (findAccessibleLead in the service answers 404 before any AI check).
leadsRouter.use('/:id/ai', validate({ params: idParamSchema }), aiRouter);
