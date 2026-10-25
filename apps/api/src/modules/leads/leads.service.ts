// Leads service: pipeline CRUD + stage machine. Lead doubles as Customer
// (ADR-004); soft-deleted leads vanish from every read path (no restore yet).
// Access model (ADR-007): agents only ever touch leads assigned to them —
// cross-scope access answers 404, not 403, so lead ids cannot be probed.
import type { Request } from 'express';
import { prisma } from '../../lib/prisma.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { paginated, parsePagination } from '../../http/response.js';
import type { TokenPayload } from '../../lib/tokens.js';
import type { Prisma, PipelineStage, SiteVisitStatus } from '../../generated/prisma/client.js';
import { allowedTargets, canTransition } from './leads.pipeline.js';
import type {
  CreateLeadInput,
  ListLeadsQuery,
  ScheduleVisitInput,
  UpdateLeadInput,
} from './leads.schemas.js';

const SAFE_USER_SELECT = { id: true, name: true, email: true, role: true } as const;
const PROPERTY_SUMMARY = {
  id: true,
  title: true,
  price: true,
  location: true,
  city: true,
  type: true,
  status: true,
} as const;

const LEAD_DETAIL_INCLUDE = {
  assignedTo: { select: SAFE_USER_SELECT },
  inquiries: {
    include: { property: { select: PROPERTY_SUMMARY } },
    orderBy: { createdAt: 'desc' },
  },
  siteVisits: {
    include: { property: { select: { id: true, title: true, location: true, city: true } } },
    orderBy: { scheduledAt: 'desc' },
  },
  _count: { select: { activities: true, tasks: true } },
} satisfies Prisma.LeadInclude;

function leadScope(auth: TokenPayload): Prisma.LeadWhereInput {
  return auth.role === 'AGENT' ? { assignedToId: auth.sub } : {};
}

export async function findAccessibleLead(id: string, auth: TokenPayload) {
  const lead = await prisma.lead.findFirst({
    where: { id, deletedAt: null, ...leadScope(auth) },
  });
  if (!lead) throw new NotFoundError('Lead not found');
  return lead;
}

async function assertUserExists(id: string, field: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) throw new ValidationError(`${field} does not reference an existing user`);
}

async function leadDetail(id: string) {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id }, include: LEAD_DETAIL_INCLUDE });
  // The stage machine stays the API's single source of truth (ADR-009): hand
  // the UI the legal next moves for the current stage so it renders exactly
  // the valid buttons and never re-implements the transition table.
  return { ...lead, allowedTransitions: allowedTargets(lead.stage) };
}

export async function listLeads(req: Request, auth: TokenPayload) {
  const q = req.validatedQuery as ListLeadsQuery;
  const { page, pageSize, skip, take } = parsePagination(req);
  const manager = auth.role !== 'AGENT';

  const where: Prisma.LeadWhereInput = {
    ...leadScope(auth),
    // Soft-deleted rows are hidden from everyone by default; only
    // managers/admins may ask for them (audit flows).
    deletedAt: manager && q.includeDeleted ? undefined : null,
    stage: q.stage,
    source: q.source,
    priority: q.priority,
    // Agents' list is already scoped; their assignedToId param can only
    // narrow within that scope, so forcing self is both safe and predictable.
    assignedToId: manager ? q.assignedToId : auth.sub,
    convertedToCustomer: q.converted,
    createdAt: { gte: q.createdFrom, lte: q.createdTo },
    ...(q.q
      ? {
          OR: [
            { name: { contains: q.q, mode: 'insensitive' } },
            { email: { contains: q.q, mode: 'insensitive' } },
            { phone: { contains: q.q } },
          ],
        }
      : {}),
  };

  const [total, data] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
      include: {
        assignedTo: { select: SAFE_USER_SELECT },
        _count: { select: { inquiries: true, siteVisits: true, activities: true } },
      },
    }),
  ]);
  return paginated(data, { page, pageSize, total });
}

export async function createLead(input: CreateLeadInput, auth: TokenPayload) {
  const isAgent = auth.role === 'AGENT';
  if (isAgent && input.assignedToId !== undefined && input.assignedToId !== auth.sub) {
    throw new ForbiddenError('Agents can only create leads assigned to themselves');
  }
  const assignedToId = isAgent ? auth.sub : (input.assignedToId ?? null);
  if (assignedToId) await assertUserExists(assignedToId, 'assignedToId');

  const lead = await prisma.lead.create({
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone,
      source: input.source,
      budgetMin: input.budgetMin,
      budgetMax: input.budgetMax,
      preferredLocation: input.preferredLocation,
      priority: input.priority,
      assignedToId,
    },
    include: LEAD_DETAIL_INCLUDE,
  });
  return lead;
}

export async function getLead(id: string, auth: TokenPayload) {
  await findAccessibleLead(id, auth);
  return leadDetail(id);
}

export async function updateLead(id: string, input: UpdateLeadInput, auth: TokenPayload) {
  await findAccessibleLead(id, auth);
  await prisma.lead.update({ where: { id }, data: input });
  return leadDetail(id);
}

export async function changeStage(
  id: string,
  to: PipelineStage,
  note: string | undefined,
  auth: TokenPayload,
) {
  const lead = await findAccessibleLead(id, auth);
  if (lead.stage === to) throw new ConflictError(`Lead is already in stage ${to}`);
  if (!canTransition(lead.stage, to)) {
    throw new ConflictError(
      `Cannot move a lead from ${lead.stage} to ${to} (allowed: ${allowedTargets(lead.stage).join(', ') || 'none'})`,
    );
  }

  // Update + STAGE_CHANGE activity in one transaction: the timeline can never
  // disagree with the pipeline state.
  const now = new Date();
  const converting = to === 'CLOSED_WON' && !lead.convertedToCustomer;
  await prisma.$transaction([
    prisma.lead.update({
      where: { id },
      data: {
        stage: to,
        // Conversion happens once; keep the first convertedAt on revival flows.
        ...(converting ? { convertedToCustomer: true, convertedAt: lead.convertedAt ?? now } : {}),
      },
    }),
    prisma.activity.create({
      data: {
        leadId: id,
        userId: auth.sub,
        type: 'STAGE_CHANGE',
        content: `Stage changed from ${lead.stage} to ${to}`,
        metadata: { from: lead.stage, to, ...(note ? { note } : {}) },
      },
    }),
  ]);
  return leadDetail(id);
}

// MANAGER/ADMIN only (enforced at the route level).
export async function assignLead(id: string, assignedToId: string | null, auth: TokenPayload) {
  await findAccessibleLead(id, auth);
  if (assignedToId) await assertUserExists(assignedToId, 'assignedToId');
  await prisma.lead.update({ where: { id }, data: { assignedToId } });
  return leadDetail(id);
}

// Site visits were display-only (seed data) — this is the write path.
// Scoped exactly like the lead itself: agents schedule visits on their own
// leads, managers/admins on any accessible lead. Scheduling and status changes
// are written to the timeline as SITE_VISIT activities so the interaction log
// tells the whole story, mirroring how stage moves write STAGE_CHANGE.
const VISIT_PROPERTY_SELECT = { id: true, title: true, location: true, city: true } as const;

export async function scheduleSiteVisit(
  leadId: string,
  input: ScheduleVisitInput,
  auth: TokenPayload,
) {
  await findAccessibleLead(leadId, auth);
  const property = await prisma.property.findUnique({
    where: { id: input.propertyId },
    select: { id: true },
  });
  if (!property) throw new NotFoundError('Property not found');

  return prisma.$transaction(async (tx) => {
    const visit = await tx.siteVisit.create({
      data: { leadId, propertyId: input.propertyId, scheduledAt: input.scheduledAt },
      include: { property: { select: VISIT_PROPERTY_SELECT } },
    });
    await tx.activity.create({
      data: {
        leadId,
        userId: auth.sub,
        type: 'SITE_VISIT',
        content: `Site visit scheduled for ${input.scheduledAt.toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}`,
        metadata: { visitId: visit.id, propertyId: input.propertyId },
      },
    });
    return visit;
  });
}

export async function updateSiteVisitStatus(
  leadId: string,
  visitId: string,
  status: SiteVisitStatus,
  auth: TokenPayload,
) {
  await findAccessibleLead(leadId, auth);
  const visit = await prisma.siteVisit.findFirst({ where: { id: visitId, leadId } });
  if (!visit) throw new NotFoundError('Site visit not found');
  if (visit.status === status) throw new ConflictError(`Visit is already ${status}`);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.siteVisit.update({
      where: { id: visitId },
      data: { status },
      include: { property: { select: VISIT_PROPERTY_SELECT } },
    });
    await tx.activity.create({
      data: {
        leadId,
        userId: auth.sub,
        type: 'SITE_VISIT',
        content: `Site visit ${status.toLowerCase().replace('_', ' ')}`,
        metadata: { visitId, from: visit.status, to: status },
      },
    });
    return updated;
  });
}

// MANAGER/ADMIN only. Soft delete keeps activities/tasks referentially intact.
export async function softDeleteLead(id: string, auth: TokenPayload) {
  await findAccessibleLead(id, auth);
  const lead = await prisma.lead.update({
    where: { id },
    data: { deletedAt: new Date() },
    select: { id: true, deletedAt: true },
  });
  return lead;
}

export async function addInquiry(
  leadId: string,
  propertyId: string,
  note: string | undefined,
  auth: TokenPayload,
) {
  await findAccessibleLead(leadId, auth);
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw new NotFoundError('Property not found');

  const existing = await prisma.leadProperty.findUnique({
    where: { leadId_propertyId: { leadId, propertyId } },
  });
  if (existing) throw new ConflictError('Lead is already interested in this property');

  return prisma.leadProperty.create({
    data: { leadId, propertyId, note },
    include: { property: { select: PROPERTY_SUMMARY } },
  });
}
