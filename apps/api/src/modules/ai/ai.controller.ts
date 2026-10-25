import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authOf } from '../../middleware/authenticate.js';
import { ok } from '../../http/response.js';
import * as aiService from './ai.service.js';
import type { AiAssistInput } from './ai.schemas.js';

// Mounted under leadsRouter at /:id/ai — :id is re-exposed via mergeParams,
// and the body is already validated (optional note).
const noteOf = (req: Request): string | undefined => (req.body as AiAssistInput | undefined)?.note;

export const score = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  ok(res, await aiService.scoreLead(id, noteOf(req), authOf(req)));
});

export const draftEmail = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  ok(res, await aiService.draftFollowUpEmail(id, noteOf(req), authOf(req)));
});

export const summarize = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  ok(res, await aiService.summarizeInteractions(id, noteOf(req), authOf(req)));
});

export const suggestTasks = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  ok(res, await aiService.suggestTasks(id, noteOf(req), authOf(req)));
});
