// The pipeline stage machine, kept pure and separate from I/O so the rules are
// greppable and testable. Design (ADR-007):
// - Forward moves may skip stages (small pipelines hate forced busywork).
// - CLOSED_WON is terminal: a won deal does not un-happen.
// - CLOSED_LOST revives only to NEW_LEAD: a re-engaged lead restarts fresh,
//   not halfway down someone's old pipeline.
import type { PipelineStage } from '../../generated/prisma/client.js';

const ALLOWED_TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  NEW_LEAD: ['CONTACTED', 'CLOSED_LOST'],
  CONTACTED: ['NEW_LEAD', 'SITE_VISIT', 'CLOSED_LOST'],
  SITE_VISIT: ['CONTACTED', 'NEGOTIATION', 'CLOSED_LOST'],
  NEGOTIATION: ['SITE_VISIT', 'CLOSED_WON', 'CLOSED_LOST'],
  CLOSED_WON: [],
  CLOSED_LOST: ['NEW_LEAD'],
};

export function canTransition(from: PipelineStage, to: PipelineStage): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function allowedTargets(from: PipelineStage): PipelineStage[] {
  return [...ALLOWED_TRANSITIONS[from]];
}
