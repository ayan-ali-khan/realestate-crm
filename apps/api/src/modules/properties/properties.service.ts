// Properties service: catalog reads for every signed-in user (filtered,
// paginated) plus listings management — create and Cloudinary-backed image
// uploads — for ADMIN/MANAGER.
import type { Request } from 'express';
import { prisma } from '../../lib/prisma.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { paginated, parsePagination } from '../../http/response.js';
import {
  assertCloudinaryConfigured,
  destroyImageByUrl,
  uploadImage,
} from '../../lib/cloudinary.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CreatePropertyInput, ListPropertiesQuery } from './properties.schemas.js';

// Hard cap for one property's gallery, enforced in one place: on the create
// body (schema) and here for the append path.
export const MAX_IMAGES = 8;

// Description/amenities stay out of the list view: the picker and cards never
// render them, and they are the payload-heavy fields. `images` comes back so
// cards can show a thumbnail and manage the gallery.
const PROPERTY_CARD_SELECT = {
  id: true,
  title: true,
  price: true,
  location: true,
  city: true,
  type: true,
  bedrooms: true,
  bathrooms: true,
  areaSqft: true,
  status: true,
  images: true,
} as const;

export async function listProperties(req: Request) {
  const q = req.validatedQuery as ListPropertiesQuery;
  const { page, pageSize, skip, take } = parsePagination(req);

  const where: Prisma.PropertyWhereInput = {
    city: q.city,
    type: q.type,
    status: q.status,
    // Free-text over title + location; ILIKE via `contains` with insensitive mode.
    ...(q.q
      ? {
          OR: [
            { title: { contains: q.q, mode: 'insensitive' } },
            { location: { contains: q.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, data] = await Promise.all([
    prisma.property.count({ where }),
    prisma.property.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: PROPERTY_CARD_SELECT,
    }),
  ]);
  return paginated(data, { page, pageSize, total });
}

/** POST /properties — body arrives pre-validated (validate middleware). */
export async function createProperty(req: Request) {
  const input = req.body as CreatePropertyInput;
  return prisma.property.create({ data: input });
}

/** POST /:id/images — multipart field "images", streamed to Cloudinary. */
export async function addPropertyImages(req: Request) {
  const { id } = req.validatedParams as { id: string };
  const property = await findOr404(id);
  const files = (req.files ?? []) as Express.Multer.File[];
  if (files.length === 0) {
    throw new ValidationError('Attach at least one image (multipart field "images")');
  }
  if (property.images.length + files.length > MAX_IMAGES) {
    throw new ValidationError(`A property can hold at most ${MAX_IMAGES} images`);
  }
  // Config check before any bytes move (same 503 contract as AI_API_KEY).
  assertCloudinaryConfigured();

  const uploaded: string[] = [];
  try {
    // Sequential on purpose: tiny batches and a clean rollback story below.
    for (const file of files) uploaded.push(await uploadImage(file.buffer));
  } catch (err) {
    // A partially-uploaded batch must not leak assets on the CDN.
    await Promise.allSettled(uploaded.map((url) => destroyImageByUrl(url)));
    throw err;
  }

  return prisma.property.update({
    where: { id: property.id },
    data: { images: [...property.images, ...uploaded] },
  });
}

/** DELETE /:id/images/:index — commit first, then best-effort CDN delete. */
export async function removePropertyImage(req: Request) {
  // The route's params schema already guarantees id/index shape (digits only).
  const { id, index: rawIndex } = req.validatedParams as { id: string; index: string };
  const property = await findOr404(id);
  const index = Number(rawIndex);
  if (index >= property.images.length) throw new NotFoundError('Image not found');
  const removed = property.images[index] as string;
  const remaining = property.images.filter((_, i) => i !== index);

  // The row is the source of truth: commit, then try to also free the asset.
  const updated = await prisma.property.update({
    where: { id: property.id },
    data: { images: remaining },
  });
  await destroyImageByUrl(removed);
  return updated;
}

async function findOr404(id: string) {
  const property = await prisma.property.findUnique({ where: { id } });
  if (!property) throw new NotFoundError('Property not found');
  return property;
}