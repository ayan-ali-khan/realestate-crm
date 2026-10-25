import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authOf } from '../../middleware/authenticate.js';
import { created, ok } from '../../http/response.js';
import * as leadsService from './leads.service.js';
import type {
  CreateLeadInput,
  ScheduleVisitInput,
  UpdateLeadInput,
  UpdateVisitInput,
} from './leads.schemas.js';
import type { PipelineStage } from '../../generated/prisma/client.js';

export const list = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await leadsService.listLeads(req, authOf(req)));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  created(res, await leadsService.createLead(req.body as CreateLeadInput, authOf(req)));
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  ok(res, await leadsService.getLead(id, authOf(req)));
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  ok(res, await leadsService.updateLead(id, req.body as UpdateLeadInput, authOf(req)));
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  ok(res, await leadsService.softDeleteLead(id, authOf(req)));
});

export const changeStage = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const { stage, note } = req.body as { stage: PipelineStage; note?: string };
  ok(res, await leadsService.changeStage(id, stage, note, authOf(req)));
});

export const assign = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const { assignedToId } = req.body as { assignedToId: string | null };
  ok(res, await leadsService.assignLead(id, assignedToId, authOf(req)));
});

export const addInquiry = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const { propertyId, note } = req.body as { propertyId: string; note?: string };
  created(res, await leadsService.addInquiry(id, propertyId, note, authOf(req)));
});

export const scheduleVisit = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  created(res, await leadsService.scheduleSiteVisit(id, req.body as ScheduleVisitInput, authOf(req)));
});

export const updateVisit = asyncHandler(async (req: Request, res: Response) => {
  const { id, visitId } = req.params as { id: string; visitId: string };
  const { status } = req.body as UpdateVisitInput;
  ok(res, await leadsService.updateSiteVisitStatus(id, visitId, status, authOf(req)));
});
