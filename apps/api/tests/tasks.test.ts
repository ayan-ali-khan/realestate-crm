// Phase 3: tasks — creation rules, agent/manager scoping, overdue semantics
// (isOverdue = PENDING && dueAt < now, repaired on read), reassignment RBAC.
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ACCESS_COOKIE } from '../src/lib/tokens.js';
import { api, cookieHeader, uniqueEmail } from './helpers.js';

const app = buildApp();

const TAG = `p3task-${Date.now().toString(36)}`;

async function login(email: string, password: string): Promise<string> {
  const res = await api(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return cookieHeader(res, ACCESS_COOKIE);
}

function iso(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 86_400_000).toISOString();
}

describe('tasks API', () => {
  let agentA: { cookie: string; id: string };
  let agentB: { cookie: string; id: string };
  let managerCookie: string;
  let leadId: string; // owned by agentA
  let foreignLeadId: string; // owned by agentB

  let myOverdueTaskId: string;
  let myFutureTaskId: string;

  beforeAll(async () => {
    managerCookie = await login('manager@crm.test', 'Password123!');

    const regA = await api(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Task A', email: uniqueEmail('task-a'), password: 'password123' });
    agentA = { cookie: cookieHeader(regA, ACCESS_COOKIE), id: regA.body.data.id as string };

    const regB = await api(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Task B', email: uniqueEmail('task-b'), password: 'password123' });
    agentB = { cookie: cookieHeader(regB, ACCESS_COOKIE), id: regB.body.data.id as string };

    const mine = await api(app)
      .post('/api/v1/leads')
      .set('Cookie', agentA.cookie)
      .send({ name: `${TAG} lead`, phone: '+15552001', source: 'WEBSITE' });
    leadId = mine.body.data.id as string;

    const theirs = await api(app)
      .post('/api/v1/leads')
      .set('Cookie', agentB.cookie)
      .send({ name: `${TAG} foreign`, phone: '+15552002', source: 'WEBSITE' });
    foreignLeadId = theirs.body.data.id as string;
  });

  describe('creation', () => {
    it('creates a task for oneself with a future due date (not overdue)', async () => {
      const res = await api(app)
        .post('/api/v1/tasks')
        .set('Cookie', agentA.cookie)
        .send({ leadId, title: `${TAG} future`, dueAt: iso(3) });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        status: 'PENDING',
        isOverdue: false,
        createdBy: 'USER',
      });
      expect(res.body.data.assignee).toMatchObject({ id: agentA.id });
      expect(res.body.data.lead).toMatchObject({ id: leadId });
      myFutureTaskId = res.body.data.id as string;
    });

    it('a past-due task is overdue at creation', async () => {
      const res = await api(app)
        .post('/api/v1/tasks')
        .set('Cookie', agentA.cookie)
        .send({ leadId, title: `${TAG} overdue`, dueAt: iso(-1) });
      expect(res.status).toBe(201);
      expect(res.body.data.isOverdue).toBe(true);
      myOverdueTaskId = res.body.data.id as string;
    });

    it('an agent cannot create a task for someone else (403)', async () => {
      const res = await api(app)
        .post('/api/v1/tasks')
        .set('Cookie', agentA.cookie)
        .send({ leadId, title: `${TAG} not mine`, dueAt: iso(2), assigneeId: agentB.id });
      expect(res.status).toBe(403);
    });

    it('404s a task on an inaccessible lead', async () => {
      const res = await api(app)
        .post('/api/v1/tasks')
        .set('Cookie', agentA.cookie)
        .send({ leadId: foreignLeadId, title: `${TAG} probe`, dueAt: iso(2) });
      expect(res.status).toBe(404);
    });

    it('400s an empty title', async () => {
      const res = await api(app)
        .post('/api/v1/tasks')
        .set('Cookie', agentA.cookie)
        .send({ leadId, title: '', dueAt: iso(2) });
      expect(res.status).toBe(400);
    });

    it('a manager creates a task assigned to an agent', async () => {
      const res = await api(app)
        .post('/api/v1/tasks')
        .set('Cookie', managerCookie)
        .send({ leadId, title: `${TAG} delegated`, dueAt: iso(5), assigneeId: agentA.id });
      expect(res.status).toBe(201);
      expect(res.body.data.assignee).toMatchObject({ id: agentA.id });
    });
  });

  describe('listing + filters', () => {
    it('scopes an agent to their own tasks', async () => {
      const res = await api(app).get('/api/v1/tasks').set('Cookie', agentA.cookie);
      expect(res.status).toBe(200);
      const ids = res.body.data.data.map((t: { id: string }) => t.id);
      expect(ids).toContain(myFutureTaskId);
      expect(ids).toContain(myOverdueTaskId);
      expect(
        res.body.data.data.every((t: { assignee: { id: string } }) => t.assignee.id === agentA.id),
      ).toBe(true);
    });

    it('filters overdue=true', async () => {
      const res = await api(app).get('/api/v1/tasks?overdue=true').set('Cookie', agentA.cookie);
      expect(res.status).toBe(200);
      const ids = res.body.data.data.map((t: { id: string }) => t.id);
      expect(ids).toContain(myOverdueTaskId);
      expect(ids).not.toContain(myFutureTaskId);
      expect(res.body.data.data.every((t: { isOverdue: boolean }) => t.isOverdue)).toBe(true);
    });

    it('filters by status and by assignee (manager view)', async () => {
      const pending = await api(app)
        .get('/api/v1/tasks?status=PENDING')
        .set('Cookie', managerCookie);
      expect(pending.body.data.data.every((t: { status: string }) => t.status === 'PENDING')).toBe(
        true,
      );

      const forA = await api(app)
        .get(`/api/v1/tasks?assigneeId=${agentA.id}`)
        .set('Cookie', managerCookie);
      expect(
        forA.body.data.data.every((t: { assignee: { id: string } }) => t.assignee.id === agentA.id),
      ).toBe(true);
      expect(forA.body.data.data.length).toBeGreaterThanOrEqual(3);
    });

    it('an agent filtering by another assignee still only sees their own', async () => {
      const res = await api(app)
        .get(`/api/v1/tasks?assigneeId=${agentB.id}`)
        .set('Cookie', agentA.cookie);
      expect(res.status).toBe(200);
      expect(
        res.body.data.data.every((t: { assignee: { id: string } }) => t.assignee.id === agentA.id),
      ).toBe(true);
    });

    it('filters by due-date range', async () => {
      const res = await api(app)
        .get(`/api/v1/tasks?dueFrom=${iso(1)}&dueTo=${iso(4)}`)
        .set('Cookie', agentA.cookie);
      expect(res.status).toBe(200);
      const ids = res.body.data.data.map((t: { id: string }) => t.id);
      expect(ids).toContain(myFutureTaskId);
      expect(ids).not.toContain(myOverdueTaskId);
    });
  });

  describe('updates + overdue semantics', () => {
    it('assignee completes a task: status DONE clears overdue', async () => {
      const res = await api(app)
        .patch(`/api/v1/tasks/${myOverdueTaskId}`)
        .set('Cookie', agentA.cookie)
        .send({ status: 'DONE' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'DONE', isOverdue: false });
    });

    it('reopening to PENDING past-due flips isOverdue back', async () => {
      const res = await api(app)
        .patch(`/api/v1/tasks/${myOverdueTaskId}`)
        .set('Cookie', agentA.cookie)
        .send({ status: 'PENDING' });
      expect(res.status).toBe(200);
      expect(res.body.data.isOverdue).toBe(true);
    });

    it('extending the due date clears overdue', async () => {
      const res = await api(app)
        .patch(`/api/v1/tasks/${myOverdueTaskId}`)
        .set('Cookie', agentA.cookie)
        .send({ dueAt: iso(7) });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'PENDING', isOverdue: false });
      // Restore overdue state for filter tests already run; keep as-is (past-due
      // semantics are covered above either way).
    });

    it('an agent cannot reassign a task (403)', async () => {
      const res = await api(app)
        .patch(`/api/v1/tasks/${myFutureTaskId}`)
        .set('Cookie', agentA.cookie)
        .send({ assigneeId: agentB.id });
      expect(res.status).toBe(403);
    });

    it('a manager reassigns; access follows the assignee', async () => {
      const res = await api(app)
        .patch(`/api/v1/tasks/${myFutureTaskId}`)
        .set('Cookie', managerCookie)
        .send({ assigneeId: agentB.id });
      expect(res.status).toBe(200);
      expect(res.body.data.assignee).toMatchObject({ id: agentB.id });

      // A can no longer see or edit it.
      const aView = await api(app)
        .patch(`/api/v1/tasks/${myFutureTaskId}`)
        .set('Cookie', agentA.cookie)
        .send({ status: 'DONE' });
      expect(aView.status).toBe(404);

      // Hand back for subsequent tests.
      await api(app)
        .patch(`/api/v1/tasks/${myFutureTaskId}`)
        .set('Cookie', managerCookie)
        .send({ assigneeId: agentA.id });
    });

    it('another agent gets 404 (no id probing)', async () => {
      const res = await api(app)
        .patch(`/api/v1/tasks/${myFutureTaskId}`)
        .set('Cookie', agentB.cookie)
        .send({ status: 'CANCELLED' });
      expect(res.status).toBe(404);
    });

    it('rejects an empty PATCH', async () => {
      const res = await api(app)
        .patch(`/api/v1/tasks/${myFutureTaskId}`)
        .set('Cookie', agentA.cookie)
        .send({});
      expect(res.status).toBe(400);
    });

    it('404s an unknown task id', async () => {
      const res = await api(app)
        .patch('/api/v1/tasks/no-such-task')
        .set('Cookie', managerCookie)
        .send({ status: 'DONE' });
      expect(res.status).toBe(404);
    });
  });
});
