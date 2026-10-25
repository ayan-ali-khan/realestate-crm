// Activities service: the per-lead interaction timeline (calls, emails,
// notes). Read/write access mirrors lead access — if you can see the lead,
// you can see and add to its timeline (ADR-007).
import type { Request } from 'express';
import { prisma } from '../../lib/prisma.js';
import { paginated, parsePagination } from '../../http/response.js';
import { findAccessibleLead } from '../leads/leads.service.js';
import type { TokenPayload } from '../../lib/tokens.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CreateActivityInput, ListActivitiesQuery } from './activities.schemas.js';

const SAFE_USER_SELECT = { id: true, name: true, email: true, role: true } as const;

export async function listActivities(leadId: string, req: Request, auth: TokenPayload) {
  await findAccessibleLead(leadId, auth);
  const { type } = req.validatedQuery as ListActivitiesQuery;
  const { page, pageSize, skip, take } = parsePagination(req);
  const where = { leadId, ...(type ? { type } : {}) };

  const [total, data] = await Promise.all([
    prisma.activity.count({ where }),
    prisma.activity.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
      include: { user: { select: SAFE_USER_SELECT } },
    }),
  ]);
  return paginated(data, { page, pageSize, total });
}

export async function createActivity(
  leadId: string,
  input: CreateActivityInput,
  auth: TokenPayload,
) {
  await findAccessibleLead(leadId, auth);
  return prisma.activity.create({
    data: {
      leadId,
      userId: auth.sub,
      type: input.type,
      content: input.content,
      // zod's Record<string, unknown> is wider than Prisma's InputJsonValue.
      // The body already passed express.json + zod validation, so values are
      // JSON-safe; this narrows the type, it does not weaken the check.
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
    include: { user: { select: SAFE_USER_SELECT } },
  });
}
