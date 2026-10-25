// Zod schemas for the property catalog. Reads are open to any signed-in user
// (agents match leads to listings via inquiries); creating a listing is
// listings management — ADMIN/MANAGER at the route (properties.routes.ts),
// the same role policy as deleting a lead.
import { z } from 'zod';
import { PropertyStatus, PropertyType } from '../../generated/prisma/client.js';

export const listPropertiesQuerySchema = z.object({
  city: z.string().trim().min(1).max(120).optional(),
  type: z.enum(PropertyType).optional(),
  status: z.enum(PropertyStatus).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export type ListPropertiesQuery = z.infer<typeof listPropertiesQuerySchema>;

// Path params — the same pattern as leads/tasks: validated at the route so
// services receive typed strings instead of Express 5's
// string | string[] | undefined.
export const idParamSchema = z.object({ id: z.string().min(1) });

export const imageIndexParamSchema = z.object({
  id: z.string().min(1),
  index: z.string().regex(/^\d+$/, 'Image index must be a non-negative integer'),
});

// POST /properties — whole currency units, no floats (see schema.prisma).
// Defaults mirror the column defaults, so the validated body is already a
// complete object for the Prisma create — no optionality drift between the
// route contract and the database.
export const createPropertySchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(4000),
  price: z.number().int().positive(),
  location: z.string().trim().min(3).max(300),
  city: z.string().trim().min(2).max(120),
  type: z.enum(PropertyType),
  bedrooms: z.number().int().min(0).max(50).default(0),
  bathrooms: z.number().int().min(0).max(50).default(0),
  areaSqft: z.number().int().positive(),
  amenities: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  // Seed/manual listings can carry plain URLs; CDN uploads arrive through the
  // multipart endpoint instead (POST /:id/images) and append to this array.
  images: z.array(z.url()).max(8).default([]),
  status: z.enum(PropertyStatus).default('AVAILABLE'),
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;