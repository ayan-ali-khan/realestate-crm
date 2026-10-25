// Phase 3: lead activity timeline — create/list, type restrictions, access
// scoping. Stage-change activities are asserted in leads.test.ts (they only
// originate from the stage endpoint).
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ACCESS_COOKIE } from '../src/lib/tokens.js';
import { api, cookieHeader, uniqueEmail } from './helpers.js';

const app = buildApp();

const TAG = `p3act-${Date.now().toString(36)}`;

async function login(email: string, password: string): Promise<string> {
  const res = await api(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return cookieHeader(res, ACCESS_COOKIE);
}

describe('activities API', () => {
  let agentA: string;
  let agentB: string;
  let leadId: string;
  let foreignLeadId: string;

  beforeAll(async () => {
    const regA = await api(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Act A', email: uniqueEmail('act-a'), password: 'password123' });
    agentA = cookieHeader(regA, ACCESS_COOKIE);

    const regB = await api(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Act B', email: uniqueEmail('act-b'), password: 'password123' });
    agentB = cookieHeader(regB, ACCESS_COOKIE);

    const manager = await login('manager@crm.test', 'Password123!');

    const mine = await api(app)
      .post('/api/v1/leads')
      .set('Cookie', agentA)
      .send({ name: `${TAG} mine`, phone: '+15551001', source: 'WEBSITE' });
    leadId = mine.body.data.id as string;

    const theirs = await api(app)
      .post('/api/v1/leads')
      .set('Cookie', agentB)
      .send({ name: `${TAG} theirs`, phone: '+15551002', source: 'WEBSITE' });
    foreignLeadId = theirs.body.data.id as string;
    expect(manager).toBeTruthy();
  });

  it('logs a CALL activity with the actor attached', async () => {
    const res = await api(app)
      .post(`/api/v1/leads/${leadId}/activities`)
      .set('Cookie', agentA)
      .send({
        type: 'CALL',
        content: 'Intro call — interested in 2BR',
        metadata: { durationSec: 180 },
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: 'CALL',
      content: 'Intro call — interested in 2BR',
    });
    expect(res.body.data.metadata).toMatchObject({ durationSec: 180 });
    expect(res.body.data.user).toHaveProperty('id');
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
  });

  it('rejects client-created STAGE_CHANGE and AI_ACTION types', async () => {
    for (const type of ['STAGE_CHANGE', 'AI_ACTION']) {
      const res = await api(app)
        .post(`/api/v1/leads/${leadId}/activities`)
        .set('Cookie', agentA)
        .send({ type, content: 'trying to forge the timeline' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects empty content', async () => {
    const res = await api(app)
      .post(`/api/v1/leads/${leadId}/activities`)
      .set('Cookie', agentA)
      .send({ type: 'NOTE', content: '' });
    expect(res.status).toBe(400);
  });

  it('404s an agent posting to a lead they do not own', async () => {
    const res = await api(app)
      .post(`/api/v1/leads/${foreignLeadId}/activities`)
      .set('Cookie', agentA)
      .send({ type: 'NOTE', content: 'should not land' });
    expect(res.status).toBe(404);
  });

  it('lists the timeline newest-first with pagination', async () => {
    // Add a second activity so ordering is observable.
    await api(app)
      .post(`/api/v1/leads/${leadId}/activities`)
      .set('Cookie', agentA)
      .send({ type: 'EMAIL', content: 'Follow-up brochure sent' });

    const res = await api(app).get(`/api/v1/leads/${leadId}/activities`).set('Cookie', agentA);
    expect(res.status).toBe(200);
    const items = res.body.data.data as { type: string; content: string; createdAt: string }[];
    expect(items.length).toBeGreaterThanOrEqual(2);
    const [newest, previous] = items;
    expect(newest?.type).toBe('EMAIL');
    expect(new Date(newest?.createdAt ?? 0).getTime()).toBeGreaterThanOrEqual(
      new Date(previous?.createdAt ?? 0).getTime(),
    );
    expect(res.body.data.meta).toMatchObject({ page: 1 });
  });

  it('filters by type', async () => {
    const res = await api(app)
      .get(`/api/v1/leads/${leadId}/activities?type=CALL`)
      .set('Cookie', agentA);
    expect(res.status).toBe(200);
    expect(res.body.data.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.data.every((a: { type: string }) => a.type === 'CALL')).toBe(true);
  });

  it("404s an agent reading another lead's timeline", async () => {
    const res = await api(app)
      .get(`/api/v1/leads/${foreignLeadId}/activities`)
      .set('Cookie', agentA);
    expect(res.status).toBe(404);
  });

  it('401s unauthenticated requests', async () => {
    const res = await api(app).get(`/api/v1/leads/${leadId}/activities`);
    expect(res.status).toBe(401);
  });
});
