import { z } from 'zod';
import {
  LeadPriority,
  LeadSource,
  PipelineStage,
  SiteVisitStatus,
} from '../../generated/prisma/client.js';

export const idParamSchema = z.object({ id: z.string().min(1) });

// Spec list/filter paths: stage, source, priority, assignee, date range, plus
// free-text search across name/email/phone and a soft-delete toggle for audit.
export const listLeadsQuerySchema = z.object({
  stage: z.enum(PipelineStage).optional(),
  source: z.enum(LeadSource).optional(),
  priority: z.enum(LeadPriority).optional(),
  assignedToId: z.string().min(1).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  converted: z.stringbool().optional(),
  includeDeleted: z.stringbool().optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

const leadCoreFields = {
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200).optional(),
  phone: z.string().trim().min(5).max(32).optional(),
  source: z.enum(LeadSource),
  budgetMin: z.number().int().nonnegative().optional(),
  budgetMax: z.number().int().nonnegative().optional(),
  preferredLocation: z.string().trim().min(1).max(200).optional(),
  priority: z.enum(LeadPriority).optional(),
};

// Walk-in leads sometimes only leave a phone number (schema comment, ADR-004):
// at least one contact channel must exist.
const hasContactChannel = (v: { email?: string; phone?: string }) =>
  v.email !== undefined || v.phone !== undefined;

const budgetsOrdered = (v: { budgetMin?: number; budgetMax?: number }) =>
  v.budgetMin === undefined || v.budgetMax === undefined || v.budgetMin <= v.budgetMax;

export const createLeadSchema = z
  .object(leadCoreFields)
  .extend({ assignedToId: z.string().min(1).optional() })
  .refine(hasContactChannel, {
    message: 'At least one of email or phone is required',
    path: ['email'],
  })
  .refine(budgetsOrdered, { message: 'budgetMin must be <= budgetMax', path: ['budgetMax'] });

// PATCH is a pure field update: stage moves through POST /:id/stage and
// assignment through POST /:id/assign (both audit-visible verbs).
export const updateLeadSchema = z
  .object(leadCoreFields)
  .partial()
  .refine(budgetsOrdered, { message: 'budgetMin must be <= budgetMax', path: ['budgetMax'] })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.email !== undefined ||
      v.phone !== undefined ||
      v.source !== undefined ||
      v.budgetMin !== undefined ||
      v.budgetMax !== undefined ||
      v.preferredLocation !== undefined ||
      v.priority !== undefined,
    { message: 'At least one field to update is required' },
  );

export const changeStageSchema = z.object({
  stage: z.enum(PipelineStage),
  note: z.string().trim().min(1).max(500).optional(),
});

export const assignLeadSchema = z.object({
  // null explicitly unassigns; omitted is not accepted (be deliberate).
  assignedToId: z.string().min(1).nullable(),
});

export const addInquirySchema = z.object({
  propertyId: z.string().min(1),
  note: z.string().trim().min(1).max(500).optional(),
});

// Site visits: schedule against an existing property, then move through the
// status lifecycle. scheduledAt is coerced like the date-range filters
// (datetime-local emits "YYYY-MM-DDTHH:mm", which Date parses as local time).
export const scheduleVisitSchema = z.object({
  propertyId: z.string().min(1),
  scheduledAt: z.coerce.date(),
});

export const updateVisitSchema = z.object({
  status: z.enum(SiteVisitStatus),
});

export const visitParamsSchema = z.object({
  id: z.string().min(1),
  visitId: z.string().min(1),
});

export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;
export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type ScheduleVisitInput = z.infer<typeof scheduleVisitSchema>;
export type UpdateVisitInput = z.infer<typeof updateVisitSchema>;
