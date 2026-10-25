// Integration tests for Phase 2: health, auth flow (incl. refresh rotation &
// replay detection), RBAC, validation errors, rate-limit plumbing.
// Runs against the isolated *_test database provisioned by global-setup.
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../src/lib/tokens.js';
import { api, clearedCookie, cookieHeader, uniqueEmail } from './helpers.js';

const app = buildApp();

describe('health', () => {
  it('responds with the envelope', async () => {
    const res = await api(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok' }, error: null });
  });

  it('checks the database with ?deep', async () => {
    const res = await api(app).get('/health?deep');
    expect(res.status).toBe(200);
    expect(res.body.data.db).toBe('ok');
  });
});

describe('auth flow', () => {
  const email = uniqueEmail('flow');

  it('registers a user and sets httpOnly cookies', async () => {
    const res = await api(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Flow User', email, password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email, role: 'AGENT' });
    expect(res.body.data.passwordHash).toBeUndefined();

    const access = res.get('Set-Cookie')?.find((c) => c.startsWith(`${ACCESS_COOKIE}=`)) ?? '';
    expect(access).toContain('HttpOnly');
    expect(access.toLowerCase()).toContain('samesite=lax');
  });

  it('rejects duplicate registration with 409', async () => {
    const res = await api(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Flow User', email, password: 'password123' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects invalid payloads with 400 VALIDATION_ERROR', async () => {
    const res = await api(app)
      .post('/api/v1/auth/register')
      .send({ name: '', email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it('rejects a wrong password with 401 (same message as unknown user)', async () => {
    const res = await api(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-password-123' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('logs in and answers /me with the user profile', async () => {
    const res = await api(app).post('/api/v1/auth/login').send({ email, password: 'password123' });
    expect(res.status).toBe(200);
    const access = cookieHeader(res, ACCESS_COOKIE);

    const me = await api(app).get('/api/v1/auth/me').set('Cookie', access);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ email, role: 'AGENT' });
  });

  it('rejects /me without a token', async () => {
    const res = await api(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('rotates refresh tokens and rejects replaying the old one', async () => {
    const login = await api(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' });
    const oldRefresh = cookieHeader(login, REFRESH_COOKIE);

    const rotated = await api(app).post('/api/v1/auth/refresh').set('Cookie', oldRefresh);
    expect(rotated.status).toBe(200);
    const newRefresh = cookieHeader(rotated, REFRESH_COOKIE);
    expect(newRefresh).not.toBe(oldRefresh);

    // Replay: the old token was revoked by the rotation above.
    const replay = await api(app).post('/api/v1/auth/refresh').set('Cookie', oldRefresh);
    expect(replay.status).toBe(401);

    // The rotated token keeps working.
    const again = await api(app).post('/api/v1/auth/refresh').set('Cookie', newRefresh);
    expect(again.status).toBe(200);
  });

  it('logout clears cookies and revokes the refresh token', async () => {
    const login = await api(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' });
    const refresh = cookieHeader(login, REFRESH_COOKIE);

    const out = await api(app).post('/api/v1/auth/logout').set('Cookie', refresh);
    expect(out.status).toBe(200);
    expect(clearedCookie(out, ACCESS_COOKIE)).toBe(true);

    const reuse = await api(app).post('/api/v1/auth/refresh').set('Cookie', refresh);
    expect(reuse.status).toBe(401);
  });

  it('auth endpoints advertise rate-limit headers (draft-8)', async () => {
    const res = await api(app).post('/api/v1/auth/login').send({ email, password: 'password123' });
    // express-rate-limit v7 with standardHeaders: 'draft-8' sends the
    // consolidated RateLimit + RateLimit-Policy headers.
    expect(res.get('ratelimit')).toBeDefined();
    expect(res.get('ratelimit-policy')).toBeDefined();
  });
});

describe('RBAC + user management', () => {
  const adminCreds = { email: 'admin@crm.test', password: 'Password123!' };

  async function loginAs(email: string, password: string): Promise<string> {
    const res = await api(app).post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return cookieHeader(res, ACCESS_COOKIE);
  }

  it('401s unauthenticated requests on protected routes', async () => {
    const res = await api(app).get('/api/v1/users');
    expect(res.status).toBe(401);
  });

  it('403s an agent on the user list', async () => {
    const agentEmail = uniqueEmail('agent');
    const reg = await api(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Agent', email: agentEmail, password: 'password123' });
    const access = cookieHeader(reg, ACCESS_COOKIE);

    const res = await api(app).get('/api/v1/users').set('Cookie', access);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('lists users (paginated) as admin', async () => {
    const access = await loginAs(adminCreds.email, adminCreds.password);
    const res = await api(app).get('/api/v1/users?pageSize=2').set('Cookie', access);
    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(2);
    expect(res.body.data.meta).toMatchObject({ page: 1, pageSize: 2 });
    expect(res.body.data.meta.total).toBeGreaterThanOrEqual(4);
    expect(res.body.data.data[0].passwordHash).toBeUndefined();
  });

  it('admin creates a user and can change their role', async () => {
    const access = await loginAs(adminCreds.email, adminCreds.password);
    const email = uniqueEmail('created');

    const created = await api(app)
      .post('/api/v1/users')
      .set('Cookie', access)
      .send({ name: 'Created User', email, password: 'password123', role: 'AGENT' });
    expect(created.status).toBe(201);

    const promoted = await api(app)
      .patch(`/api/v1/users/${created.body.data.id}/role`)
      .set('Cookie', access)
      .send({ role: 'MANAGER' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.data.role).toBe('MANAGER');
  });

  it('a manager may list users but not create them', async () => {
    const access = await loginAs('manager@crm.test', 'Password123!');
    const list = await api(app).get('/api/v1/users').set('Cookie', access);
    expect(list.status).toBe(200);

    const create = await api(app)
      .post('/api/v1/users')
      .set('Cookie', access)
      .send({ name: 'X', email: uniqueEmail('mgr'), password: 'password123', role: 'AGENT' });
    expect(create.status).toBe(403);
  });
});
