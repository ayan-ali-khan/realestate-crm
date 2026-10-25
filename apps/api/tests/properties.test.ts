// Properties: catalog reads (all roles), listings management (ADMIN/MANAGER),
// and the image endpoints' contracts — role guards, validation, and the
// unconfigured-503 path. setup.ts strips every CLOUDINARY_* var, so the
// multipart guard is deterministic and no test can ever touch a real CDN.
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ACCESS_COOKIE } from '../src/lib/tokens.js';
import { api, cookieHeader } from './helpers.js';

const app = buildApp();

async function loginAs(email: string, password = 'Password123!'): Promise<string> {
  const res = await api(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return cookieHeader(res, ACCESS_COOKIE);
}

const VALID_LISTING = {
  title: 'Test Loft on 5th Avenue',
  description: 'A bright two-bedroom loft used by the property endpoint tests.',
  price: 425000,
  location: '5th Avenue, Midtown',
  city: 'New York',
  type: 'APARTMENT',
  bedrooms: 2,
  bathrooms: 2,
  areaSqft: 1150,
};

const png = (name = 'shot.png') =>
  attachFixture({ filename: name, contentType: 'image/png' });

// supertest's .attach over a Buffer needs the options object spelled out.
function attachFixture(opts: { filename: string; contentType: string }) {
  return { filename: opts.filename, contentType: opts.contentType };
}

describe('property catalog (reads)', () => {
  it('401s without a cookie', async () => {
    const res = await api(app).get('/api/v1/properties');
    expect(res.status).toBe(401);
  });

  it('lists seeded properties with images for an agent (payload stays lean)', async () => {
    const access = await loginAs('agent@crm.test');
    const res = await api(app).get('/api/v1/properties?pageSize=5').set('Cookie', access);
    expect(res.status).toBe(200);
    expect(res.body.data.data.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.data.data[0].images)).toBe(true);
    // description/amenities are deliberately not selected for the list view.
    expect(res.body.data.data[0].description).toBeUndefined();
  });

  it('filters by free-text search', async () => {
    const access = await loginAs('agent@crm.test');
    const all = await api(app).get('/api/v1/properties?pageSize=100').set('Cookie', access);
    const target = all.body.data.data[0];
    const res = await api(app)
      .get(`/api/v1/properties?q=${encodeURIComponent(target.title.slice(0, 24))}`)
      .set('Cookie', access);
    expect(res.status).toBe(200);
    expect(res.body.data.data.some((p: { id: string }) => p.id === target.id)).toBe(true);
  });
});

describe('property creation (ADMIN/MANAGER)', () => {
  it('401s unauthenticated', async () => {
    const res = await api(app).post('/api/v1/properties').send(VALID_LISTING);
    expect(res.status).toBe(401);
  });

  it('403s an agent', async () => {
    const access = await loginAs('agent@crm.test');
    const res = await api(app)
      .post('/api/v1/properties')
      .set('Cookie', access)
      .send(VALID_LISTING);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('400s an invalid body with zod details', async () => {
    const access = await loginAs('admin@crm.test');
    const res = await api(app)
      .post('/api/v1/properties')
      .set('Cookie', access)
      .send({ ...VALID_LISTING, price: -5, title: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it('creates a listing as admin with schema defaults applied', async () => {
    const access = await loginAs('admin@crm.test');
    const res = await api(app)
      .post('/api/v1/properties')
      .set('Cookie', access)
      .send(VALID_LISTING);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      title: VALID_LISTING.title,
      city: VALID_LISTING.city,
      status: 'AVAILABLE',
      bedrooms: 2,
      amenities: [],
      images: [],
    });

    const listed = await api(app)
      .get(`/api/v1/properties?q=${encodeURIComponent(VALID_LISTING.title)}`)
      .set('Cookie', access);
    expect(listed.body.data.data.some((p: { id: string }) => p.id === res.body.data.id)).toBe(true);
  });

  it('creates a listing as a manager', async () => {
    const access = await loginAs('manager@crm.test');
    const res = await api(app)
      .post('/api/v1/properties')
      .set('Cookie', access)
      .send({ ...VALID_LISTING, title: 'Manager-created townhouse', type: 'TOWNHOUSE' });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('TOWNHOUSE');
  });
});

describe('property images', () => {
  async function createWithImage(): Promise<{ access: string; id: string }> {
    const access = await loginAs('admin@crm.test');
    const created = await api(app)
      .post('/api/v1/properties')
      .set('Cookie', access)
      .send({
        ...VALID_LISTING,
        title: 'Gallery test property',
        images: ['https://example.com/listing-photo.jpg'],
      });
    expect(created.status).toBe(201);
    return { access, id: created.body.data.id };
  }

  it('401s unauthenticated on upload', async () => {
    const res = await api(app)
      .post('/api/v1/properties/any-id/images')
      .attach('images', Buffer.from('fake'), png());
    expect(res.status).toBe(401);
  });

  it('403s an agent on upload', async () => {
    const access = await loginAs('agent@crm.test');
    const res = await api(app)
      .post('/api/v1/properties/any-id/images')
      .set('Cookie', access)
      .attach('images', Buffer.from('fake'), png());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('404s an unknown property before the upload path runs', async () => {
    const access = await loginAs('admin@crm.test');
    const res = await api(app)
      .post('/api/v1/properties/clzzzzzzzzzzzzzzzzzzzzzz/images')
      .set('Cookie', access);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('400s a multipart request with no files', async () => {
    const { access, id } = await createWithImage();
    const res = await api(app).post(`/api/v1/properties/${id}/images`).set('Cookie', access);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400s a non-image mime type', async () => {
    const { access, id } = await createWithImage();
    const res = await api(app)
      .post(`/api/v1/properties/${id}/images`)
      .set('Cookie', access)
      .attach('images', Buffer.from('not an image'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/JPEG, PNG/);
  });

  it('503s an upload while Cloudinary is unconfigured, naming the env vars', async () => {
    const { access, id } = await createWithImage();
    const res = await api(app)
      .post(`/api/v1/properties/${id}/images`)
      .set('Cookie', access)
      .attach('images', Buffer.from('fake-bytes'), png());
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('EXTERNAL_SERVICE_ERROR');
    expect(res.body.error.message).toMatch(/CLOUDINARY_CLOUD_NAME/);
  });

  it('removes an image by index and 404s an out-of-range one', async () => {
    const { access, id } = await createWithImage();

    const removed = await api(app)
      .delete(`/api/v1/properties/${id}/images/0`)
      .set('Cookie', access);
    expect(removed.status).toBe(200);
    expect(removed.body.data.images).toEqual([]);

    const missing = await api(app)
      .delete(`/api/v1/properties/${id}/images/0`)
      .set('Cookie', access);
    expect(missing.status).toBe(404);
  });

  it('400s a non-numeric image index', async () => {
    const { access, id } = await createWithImage();
    const res = await api(app)
      .delete(`/api/v1/properties/${id}/images/zero`)
      .set('Cookie', access);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});