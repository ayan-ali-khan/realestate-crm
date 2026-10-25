// Zod schemas for the lead activity timeline. Clients may only log interaction
// types: STAGE_CHANGE is written by the stage endpoint and AI_ACTION by the
// Phase 10 AI service — both rejected here so the timeline stays truthful.
import { z } from 'zod';
import { ActivityType } from '../../generated/prisma/client.js';

export const listActivitiesQuerySchema = z.object({
  type: z.enum(ActivityType).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export const createActivitySchema = z.object({
  type: z.enum(['CALL', 'EMAIL', 'NOTE']),
  content: z.string().trim().min(1).max(2000),
  // Free-form call duration / subject / outcome data.
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ListActivitiesQuery = z.infer<typeof listActivitiesQuerySchema>;
export type CreateActivityInput = z.infer<typeof createActivitySchema>;
