// Phase 3: leads pipeline — CRUD, filters, RBAC scoping, stage machine,
// conversion, soft delete, assignment, inquiries, site visits. Runs against the isolated
// *_test database provisioned by global-setup (seeded: 40 leads incl. 1
// soft-deleted and 2 converted, users admin/manager@crm.test).
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ACCESS_COOKIE } from '../src/lib/tokens.js';
import { api, cookieHeader, uniqueEmail } from './helpers.js';

const app = buildApp();

const MANAGER_CREDS = { email: 'manager@crm.test', password: 'Password123!' };

// Distinct name marker so list assertions stay deterministic even though the
// test DB is seeded with 40 leads.
const TAG = `p3-${Date.now().toString(36)}`;

async function login(email: string, password: string): Promise<string> {
  const res = await api(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return cookieHeader(res, ACCESS_COOKIE);
}

async function registerAgent(prefix: string): Promise<{ cookie: string; id: string }> {
  const email = uniqueEmail(prefix);
  const res = await api(app)
    .post('/api/v1/auth/register')
    .send({ name: `Agent ${prefix}`, email, password: 'password123' });
  expect(res.status).toBe(201);
  return { cookie: cookieHeader(res, ACCESS_COOKIE), id: res.body.data.id as string };
}

describe('leads API', () => {
  let managerCookie: string;
  let agentA: { cookie: string; id: string };
  let agentB: { cookie: string; id: string };

  // Lead created by agentA (auto-assigned to A).
  let leadId: string;
  // Lead created by agentB (auto-assigned to B).
  let otherLeadId: string;

  beforeAll(async () => {
    managerCookie = await login(MANAGER_CREDS.email, MANAGER_CREDS.password);
    agentA = await registerAgent('a');
    agentB = await registerAgent('b');
  });

  describe('creation + validation', () => {
    it('creates a lead and auto-assigns it to the creating agent', async () => {
      const res = await api(app)
        .post('/api/v1/leads')
        .set('Cookie', agentA.cookie)
        .send({
          name: `${TAG} Alpha`,
          phone: '+15550001',
          source: 'WEBSITE',
          budgetMin: 100_000,
          budgetMax: 250_000,
          preferredLocation: 'Downtown',
          priority: 'HIGH',
        });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        name: `${TAG} Alpha`,
        stage: 'NEW_LEAD',
        priority: 'HIGH',
        convertedToCustomer: false,
        aiScore: null, // no fabricated AI data (spec)
      });
      expect(res.body.data.assignedTo).toMatchObject({ id: agentA.id });
      leadId = res.body.data.id as string;
    });

    it('agent cannot create a lead assigned to someone else', async () => {
      const res = await api(app)
        .post('/api/v1/leads')
        .set('Cookie', agentA.cookie)
        .send({ name: `${TAG} X`, phone: '+15550002', source: 'WALK_IN', assignedToId: agentB.id });
      expect(res.status).toBe(403);
    });

    it('rejects a lead with neither email nor phone', async () => {
      const res = await api(app)
        .post('/api/v1/leads')
        .set('Cookie', agentA.cookie)
        .send({ name: `${TAG} NoContact`, source: 'WEBSITE' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects budgetMin > budgetMax', async () => {
      const res = await api(app)
        .post('/api/v1/leads')
        .set('Cookie', agentA.cookie)
        .send({
          name: `${TAG} BadBudget`,
          email: 'x@test.local',
          source: 'WEBSITE',
          budgetMin: 500,
          budgetMax: 100,
        });
      expect(res.status).toBe(400);
    });

    it('manager creates a lead assigned to a specific agent', async () => {
      const res = await api(app)
        .post('/api/v1/leads')
        .set('Cookie', managerCookie)
        .send({
          name: `${TAG} Beta`,
          email: 'beta-lead@test.local',
          source: 'REFERRAL',
          assignedToId: agentB.id,
        });
      expect(res.status).toBe(201);
      expect(res.body.data.assignedTo).toMatchObject({ id: agentB.id });
      otherLeadId = res.body.data.id as string;
    });

    it('rejects assigning to a non-existent user', async () => {
      const res = await api(app)
        .post('/api/v1/leads')
        .set('Cookie', managerCookie)
        .send({
          name: `${TAG} Ghost`,
          email: 'g@test.local',
          source: 'WEBSITE',
          assignedToId: 'no-such-user',
        });
      expect(res.status).toBe(400);
    });
  });

  describe('listing + filters', () => {
    it('scopes an agent to their own leads', async () => {
      const res = await api(app).get(`/api/v1/leads?q=${TAG}`).set('Cookie', agentA.cookie);
      expect(res.status).toBe(200);
      const ids = res.body.data.data.map((l: { id: string }) => l.id);
      expect(ids).toContain(leadId);
      expect(ids).not.toContain(otherLeadId);
    });

    it('managers see all leads matching the search', async () => {
      const res = await api(app).get(`/api/v1/leads?q=${TAG}`).set('Cookie', managerCookie);
      expect(res.status).toBe(200);
      const ids = res.body.data.data.map((l: { id: string }) => l.id);
      expect(ids).toContain(leadId);
      expect(ids).toContain(otherLeadId);
      expect(res.body.data.meta).toMatchObject({ page: 1 });
    });

    it('filters by stage, priority, source and assignee', async () => {
      const byStage = await api(app)
        .get(`/api/v1/leads?stage=NEW_LEAD&q=${TAG}`)
        .set('Cookie', managerCookie);
      expect(byStage.body.data.data.every((l: { stage: string }) => l.stage === 'NEW_LEAD')).toBe(
        true,
      );

      const byPriority = await api(app)
        .get(`/api/v1/leads?priority=HIGH&q=${TAG}`)
        .set('Cookie', managerCookie);
      expect(
        byPriority.body.data.data.every((l: { priority: string }) => l.priority === 'HIGH'),
      ).toBe(true);
      expect(byPriority.body.data.data.length).toBeGreaterThanOrEqual(1);

      const bySource = await api(app)
        .get(`/api/v1/leads?source=REFERRAL&q=${TAG}`)
        .set('Cookie', managerCookie);
      expect(
        bySource.body.data.data.every((l: { source: string }) => l.source === 'REFERRAL'),
      ).toBe(true);

      const byAssignee = await api(app)
        .get(`/api/v1/leads?assignedToId=${agentB.id}&q=${TAG}`)
        .set('Cookie', managerCookie);
      const assigneeIds = byAssignee.body.data.data.map(
        (l: { assignedTo: { id: string } }) => l.assignedTo.id,
      );
      expect(assigneeIds.every((id: string) => id === agentB.id)).toBe(true);
      expect(assigneeIds).toContain(agentB.id);
    });

    it('paginates with bounded pageSize', async () => {
      const res = await api(app)
        .get(`/api/v1/leads?q=${TAG}&page=1&pageSize=1`)
        .set('Cookie', managerCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.data).toHaveLength(1);
      expect(res.body.data.meta.pageSize).toBe(1);
      expect(res.body.data.meta.total).toBeGreaterThanOrEqual(2);
      expect(res.body.data.meta.totalPages).toBeGreaterThanOrEqual(2);
    });

    it("an agent listing with someone else's assignedToId still sees only their own", async () => {
      const res = await api(app)
        .get(`/api/v1/leads?assignedToId=${agentB.id}&q=${TAG}`)
        .set('Cookie', agentA.cookie);
      expect(res.status).toBe(200);
      const ids = res.body.data.data.map((l: { id: string }) => l.id);
      expect(ids).not.toContain(otherLeadId);
      expect(ids.every((id: string) => id !== otherLeadId)).toBe(true);
    });
  });

  describe('detail + update', () => {
    it('returns the lead with relations', async () => {
      const res = await api(app).get(`/api/v1/leads/${leadId}`).set('Cookie', agentA.cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: leadId, name: `${TAG} Alpha` });
      expect(res.body.data).toHaveProperty('inquiries');
      expect(res.body.data).toHaveProperty('siteVisits');
      expect(res.body.data._count).toHaveProperty('activities');
      // The API is the single source of truth for the stage machine (ADR-009):
      // a NEW_LEAD may only go to CONTACTED or CLOSED_LOST.
      expect(res.body.data.allowedTransitions).toEqual(['CONTACTED', 'CLOSED_LOST']);
    });

    it('404s an agent on a lead assigned to someone else (no id probing)', async () => {
      const res = await api(app).get(`/api/v1/leads/${otherLeadId}`).set('Cookie', agentA.cookie);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('401s unauthenticated requests', async () => {
      const res = await api(app).get(`/api/v1/leads/${leadId}`);
      expect(res.status).toBe(401);
    });

    it('updates fields via PATCH (assignee)', async () => {
      const res = await api(app)
        .patch(`/api/v1/leads/${leadId}`)
        .set('Cookie', agentA.cookie)
        .send({ budgetMax: 300_000, preferredLocation: 'Midtown', priority: 'URGENT' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        budgetMax: 300_000,
        preferredLocation: 'Midtown',
        priority: 'URGENT',
      });
    });

    it('PATCH ignores a stage key (stage changes need the stage endpoint)', async () => {
      const res = await api(app)
        .patch(`/api/v1/leads/${leadId}`)
        .set('Cookie', agentA.cookie)
        .send({ budgetMin: 50_000, stage: 'CLOSED_WON' });
      // Unknown keys are stripped by zod: the field update lands, stage does not.
      expect(res.status).toBe(200);
      expect(res.body.data.stage).toBe('NEW_LEAD');
      expect(res.body.data.budgetMin).toBe(50_000);
    });

    it('rejects an empty PATCH body', async () => {
      const res = await api(app)
        .patch(`/api/v1/leads/${leadId}`)
        .set('Cookie', agentA.cookie)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('stage machine', () => {
    it('moves NEW_LEAD → CONTACTED and logs a STAGE_CHANGE activity', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${leadId}/stage`)
        .set('Cookie', agentA.cookie)
        .send({ stage: 'CONTACTED', note: 'Called back' });
      expect(res.status).toBe(200);
      expect(res.body.data.stage).toBe('CONTACTED');

      const acts = await api(app)
        .get(`/api/v1/leads/${leadId}/activities?type=STAGE_CHANGE`)
        .set('Cookie', agentA.cookie);
      expect(acts.status).toBe(200);
      const last = acts.body.data.data[0];
      expect(last).toMatchObject({ type: 'STAGE_CHANGE' });
      expect(last.metadata).toMatchObject({
        from: 'NEW_LEAD',
        to: 'CONTACTED',
        note: 'Called back',
      });
    });

    it('rejects a skipped-forward transition with 409 + allowed targets', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${leadId}/stage`)
        .set('Cookie', agentA.cookie)
        .send({ stage: 'NEGOTIATION' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.message).toContain('SITE_VISIT');
    });

    it('rejects a same-stage transition with 409', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${leadId}/stage`)
        .set('Cookie', agentA.cookie)
        .send({ stage: 'CONTACTED' });
      expect(res.status).toBe(409);
    });

    it('walks CONTACTED → SITE_VISIT → NEGOTIATION → CLOSED_WON and converts the lead', async () => {
      for (const stage of ['SITE_VISIT', 'NEGOTIATION', 'CLOSED_WON']) {
        const res = await api(app)
          .post(`/api/v1/leads/${leadId}/stage`)
          .set('Cookie', agentA.cookie)
          .send({ stage });
        expect(res.status).toBe(200);
      }
      const res = await api(app).get(`/api/v1/leads/${leadId}`).set('Cookie', agentA.cookie);
      expect(res.body.data.stage).toBe('CLOSED_WON');
      expect(res.body.data.convertedToCustomer).toBe(true);
      expect(res.body.data.convertedAt).not.toBeNull();
    });

    it('CLOSED_WON is terminal', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${leadId}/stage`)
        .set('Cookie', agentA.cookie)
        .send({ stage: 'CONTACTED' });
      expect(res.status).toBe(409);
    });

    it('CLOSED_LOST revives to NEW_LEAD', async () => {
      // Put otherLeadId into CLOSED_LOST, then revive.
      for (const stage of ['CONTACTED', 'CLOSED_LOST']) {
        const res = await api(app)
          .post(`/api/v1/leads/${otherLeadId}/stage`)
          .set('Cookie', agentB.cookie)
          .send({ stage });
        expect(res.status).toBe(200);
      }
      const revived = await api(app)
        .post(`/api/v1/leads/${otherLeadId}/stage`)
        .set('Cookie', agentB.cookie)
        .send({ stage: 'NEW_LEAD' });
      expect(revived.status).toBe(200);
      expect(revived.body.data.stage).toBe('NEW_LEAD');
      // Revival is not a conversion.
      expect(revived.body.data.convertedToCustomer).toBe(false);
    });

    it('another agent cannot move a lead they do not own', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${otherLeadId}/stage`)
        .set('Cookie', agentA.cookie)
        .send({ stage: 'CONTACTED' });
      expect(res.status).toBe(404);
    });
  });

  describe('assignment', () => {
    it('an agent cannot assign (403)', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${leadId}/assign`)
        .set('Cookie', agentA.cookie)
        .send({ assignedToId: agentB.id });
      expect(res.status).toBe(403);
    });

    it('a manager reassigns a lead and access follows the assignment', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${leadId}/assign`)
        .set('Cookie', managerCookie)
        .send({ assignedToId: agentB.id });
      expect(res.status).toBe(200);
      expect(res.body.data.assignedTo).toMatchObject({ id: agentB.id });

      // A lost access, B gained it.
      const aView = await api(app).get(`/api/v1/leads/${leadId}`).set('Cookie', agentA.cookie);
      expect(aView.status).toBe(404);
      const bView = await api(app).get(`/api/v1/leads/${leadId}`).set('Cookie', agentB.cookie);
      expect(bView.status).toBe(200);

      // Hand back for the remaining tests.
      const back = await api(app)
        .post(`/api/v1/leads/${leadId}/assign`)
        .set('Cookie', managerCookie)
        .send({ assignedToId: agentA.id });
      expect(back.status).toBe(200);
    });

    it('unassigns with null', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${otherLeadId}/assign`)
        .set('Cookie', managerCookie)
        .send({ assignedToId: null });
      expect(res.status).toBe(200);
      expect(res.body.data.assignedTo).toBeNull();

      // Restore for any later use.
      await api(app)
        .post(`/api/v1/leads/${otherLeadId}/assign`)
        .set('Cookie', managerCookie)
        .send({ assignedToId: agentB.id });
    });
  });

  describe('property inquiries', () => {
    let propertyId: string;

    beforeAll(async () => {
      // Grab any property id from a manager-visible lead's detail.
      const list = await api(app).get('/api/v1/leads?pageSize=1').set('Cookie', managerCookie);
      const anyLead = list.body.data.data[0].id as string;
      const detail = await api(app).get(`/api/v1/leads/${anyLead}`).set('Cookie', managerCookie);
      // Seeded leads carry site visits; use its property.
      propertyId = detail.body.data.siteVisits[0]?.property.id as string;
      // Fallback: some leads may have none — walk a few.
      if (!propertyId) {
        const more = await api(app).get('/api/v1/leads?pageSize=10').set('Cookie', managerCookie);
        for (const l of more.body.data.data as { id: string }[]) {
          const d = await api(app).get(`/api/v1/leads/${l.id}`).set('Cookie', managerCookie);
          if (d.body.data.siteVisits[0]) {
            propertyId = d.body.data.siteVisits[0].property.id as string;
            break;
          }
        }
      }
      expect(propertyId).toBeTruthy();
    });

    it('attaches a property interest', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${leadId}/inquiries`)
        .set('Cookie', agentA.cookie)
        .send({ propertyId, note: 'Wants a tour' });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ leadId, propertyId, note: 'Wants a tour' });
      expect(res.body.data.property).toHaveProperty('title');
    });

    it('rejects a duplicate inquiry with 409', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${leadId}/inquiries`)
        .set('Cookie', agentA.cookie)
        .send({ propertyId });
      expect(res.status).toBe(409);
    });

    it('404s an unknown property', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${leadId}/inquiries`)
        .set('Cookie', agentA.cookie)
        .send({ propertyId: 'no-such-property' });
      expect(res.status).toBe(404);
    });

    it('appears in the lead detail', async () => {
      const res = await api(app).get(`/api/v1/leads/${leadId}`).set('Cookie', agentA.cookie);
      const found = res.body.data.inquiries.find(
        (i: { propertyId: string }) => i.propertyId === propertyId,
      );
      expect(found).toBeDefined();
    });
  });

  describe('site visits', () => {
    let propertyId: string;
    let visitId: string;

    beforeAll(async () => {
      const list = await api(app).get('/api/v1/properties?pageSize=1').set('Cookie', managerCookie);
      expect(list.status).toBe(200);
      propertyId = list.body.data.data[0].id as string;
    });

    it('an agent schedules a visit on their own lead', async () => {
      const scheduledAt = new Date(Date.now() + 86_400_000).toISOString();
      const res = await api(app)
        .post(`/api/v1/leads/${leadId}/visits`)
        .set('Cookie', agentA.cookie)
        .send({ propertyId, scheduledAt });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ leadId, propertyId, status: 'SCHEDULED' });
      expect(res.body.data.property).toHaveProperty('title');
      expect(new Date(res.body.data.scheduledAt).toISOString()).toBe(scheduledAt);
      visitId = res.body.data.id as string;
    });

    it('scheduling writes a SITE_VISIT activity to the timeline', async () => {
      const res = await api(app)
        .get(`/api/v1/leads/${leadId}/activities?pageSize=50`)
        .set('Cookie', agentA.cookie);
      const mine = res.body.data.data.find(
        (a: { metadata: { visitId?: string } | null }) => a.metadata?.visitId === visitId,
      );
      expect(mine).toBeDefined();
      expect(mine.type).toBe('SITE_VISIT');
      expect(mine.content).toContain('scheduled');
    });

    it('appears in the lead detail siteVisits', async () => {
      const res = await api(app).get(`/api/v1/leads/${leadId}`).set('Cookie', agentA.cookie);
      const found = res.body.data.siteVisits.find((v: { id: string }) => v.id === visitId);
      expect(found).toBeDefined();
    });

    it('rejects an unknown property with 404', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${leadId}/visits`)
        .set('Cookie', agentA.cookie)
        .send({ propertyId: 'no-such-property', scheduledAt: new Date().toISOString() });
      expect(res.status).toBe(404);
    });

    it('rejects a missing scheduledAt with 400', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${leadId}/visits`)
        .set('Cookie', agentA.cookie)
        .send({ propertyId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it("another agent's lead 404s (scope probing stays invisible)", async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${otherLeadId}/visits`)
        .set('Cookie', agentA.cookie)
        .send({ propertyId, scheduledAt: new Date().toISOString() });
      expect(res.status).toBe(404);
    });

    it('moves a visit through its status lifecycle', async () => {
      const res = await api(app)
        .patch(`/api/v1/leads/${leadId}/visits/${visitId}`)
        .set('Cookie', agentA.cookie)
        .send({ status: 'COMPLETED' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('COMPLETED');

      // Idempotent repetition is a conflict (same rule as stage moves).
      const again = await api(app)
        .patch(`/api/v1/leads/${leadId}/visits/${visitId}`)
        .set('Cookie', agentA.cookie)
        .send({ status: 'COMPLETED' });
      expect(again.status).toBe(409);
    });

    it('rejects an invalid status with 400', async () => {
      const res = await api(app)
        .patch(`/api/v1/leads/${leadId}/visits/${visitId}`)
        .set('Cookie', agentA.cookie)
        .send({ status: 'MAYBE' });
      expect(res.status).toBe(400);
    });

    it('an unknown visit id 404s', async () => {
      const res = await api(app)
        .patch(`/api/v1/leads/${leadId}/visits/no-such-visit`)
        .set('Cookie', agentA.cookie)
        .send({ status: 'CANCELLED' });
      expect(res.status).toBe(404);
    });
  });

  describe('soft delete', () => {
    it('an agent cannot delete (403)', async () => {
      const res = await api(app)
        .delete(`/api/v1/leads/${otherLeadId}`)
        .set('Cookie', agentB.cookie);
      expect(res.status).toBe(403);
    });

    it('a manager soft-deletes and the lead disappears from default reads', async () => {
      const del = await api(app)
        .delete(`/api/v1/leads/${otherLeadId}`)
        .set('Cookie', managerCookie);
      expect(del.status).toBe(200);
      expect(del.body.data.deletedAt).not.toBeNull();

      const detail = await api(app)
        .get(`/api/v1/leads/${otherLeadId}`)
        .set('Cookie', managerCookie);
      expect(detail.status).toBe(404);

      const list = await api(app).get(`/api/v1/leads?q=${TAG}`).set('Cookie', managerCookie);
      const ids = list.body.data.data.map((l: { id: string }) => l.id);
      expect(ids).not.toContain(otherLeadId);
    });

    it('includeDeleted=true reveals it to managers only', async () => {
      const withDeleted = await api(app)
        .get(`/api/v1/leads?includeDeleted=true&q=${TAG}`)
        .set('Cookie', managerCookie);
      const ids = withDeleted.body.data.data.map((l: { id: string }) => l.id);
      expect(ids).toContain(otherLeadId);

      // An agent never sees deleted leads, even with the flag.
      const agentView = await api(app)
        .get(`/api/v1/leads?includeDeleted=true&q=${TAG}`)
        .set('Cookie', agentA.cookie);
      const agentIds = agentView.body.data.data.map((l: { id: string }) => l.id);
      expect(agentIds).not.toContain(otherLeadId);
    });

    it('operations on a deleted lead 404', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${otherLeadId}/stage`)
        .set('Cookie', managerCookie)
        .send({ stage: 'CONTACTED' });
      expect(res.status).toBe(404);
    });
  });
});
