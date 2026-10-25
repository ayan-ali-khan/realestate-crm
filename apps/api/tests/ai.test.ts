// Phase 6: AI features. The suite never spends real money or depends on an
// upstream (tests/setup.ts deletes AI_API_KEY), so the deterministic contract
// is what we assert: without configuration every endpoint answers 503, and —
// crucially — scope checks come first, so probing another agent's lead with
// the AI endpoints answers 404, never a config error that would leak whether
// the id exists. Live model calls are verified manually against a configured
// provider (see README).
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ACCESS_COOKIE } from '../src/lib/tokens.js';
import { api, cookieHeader, uniqueEmail } from './helpers.js';

const app = buildApp();

async function registerAgent(prefix: string): Promise<{ cookie: string; id: string }> {
  const email = uniqueEmail(prefix);
  const res = await api(app)
    .post('/api/v1/auth/register')
    .send({ name: `Agent ${prefix}`, email, password: 'password123' });
  expect(res.status).toBe(201);
  return { cookie: cookieHeader(res, ACCESS_COOKIE), id: res.body.data.id as string };
}

const AI_PATHS = ['/ai/score', '/ai/draft-email', '/ai/summarize', '/ai/suggest-tasks'];

describe('AI endpoints', () => {
  let agentA: { cookie: string; id: string };
  let agentB: { cookie: string; id: string };
  let leadId: string; // owned by agentA

  beforeAll(async () => {
    agentA = await registerAgent('ai-a');
    agentB = await registerAgent('ai-b');
    const res = await api(app)
      .post('/api/v1/leads')
      .set('Cookie', agentA.cookie)
      .send({ name: 'AI Lead', email: 'ai-lead@test.local', source: 'WEBSITE' });
    expect(res.status).toBe(201);
    leadId = res.body.data.id as string;
  });

  describe('without AI_API_KEY (the test default)', () => {
    it('every endpoint answers 503 with a configuration message', async () => {
      for (const path of AI_PATHS) {
        const res = await api(app)
          .post(`/api/v1/leads/${leadId}${path}`)
          .set('Cookie', agentA.cookie)
          .send({});
        expect(res.status, path).toBe(503);
        expect(res.body.error.code).toBe('EXTERNAL_SERVICE_ERROR');
        expect(res.body.error.message).toMatch(/AI_API_KEY/);
      }
    });

    it('POST with no body at all is still a 503, not a validation error', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${leadId}/ai/score`)
        .set('Cookie', agentA.cookie);
      expect(res.status).toBe(503);
    });
  });

  describe('access scoping (checked before any AI configuration)', () => {
    it("another agent's lead answers 404 on every AI endpoint", async () => {
      for (const path of AI_PATHS) {
        const res = await api(app)
          .post(`/api/v1/leads/${leadId}${path}`)
          .set('Cookie', agentB.cookie)
          .send({});
        expect(res.status, path).toBe(404);
      }
    });

    it('an unknown lead id answers 404 for a manager too', async () => {
      const login = await api(app)
        .post('/api/v1/auth/login')
        .send({ email: 'manager@crm.test', password: 'Password123!' });
      expect(login.status).toBe(200);
      const cookie = cookieHeader(login, ACCESS_COOKIE);

      const res = await api(app)
        .post('/api/v1/leads/no-such-lead/ai/score')
        .set('Cookie', cookie)
        .send({});
      expect(res.status).toBe(404);
    });

    it('requires authentication', async () => {
      const res = await api(app).post(`/api/v1/leads/${leadId}/ai/score`).send({});
      expect(res.status).toBe(401);
    });
  });

  describe('request validation', () => {
    it('rejects an oversized note with 400', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${leadId}/ai/score`)
        .set('Cookie', agentA.cookie)
        .send({ note: 'x'.repeat(501) });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a non-string note with 400', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${leadId}/ai/draft-email`)
        .set('Cookie', agentA.cookie)
        .send({ note: 42 });
      expect(res.status).toBe(400);
    });

    it('accepts a valid note and reaches the (missing) provider', async () => {
      const res = await api(app)
        .post(`/api/v1/leads/${leadId}/ai/suggest-tasks`)
        .set('Cookie', agentA.cookie)
        .send({ note: 'Focus on budget fit' });
      expect(res.status).toBe(503);
    });
  });
});
