// The one response shape every endpoint obeys: { success, data, error }.
import type { Request, Response } from 'express';

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
}

export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ success: true, data, error: null } satisfies Envelope<T>);
}

export function created<T>(res: Response, data: T): Response {
  return ok(res, data, 201);
}

export function noContent(res: Response): Response {
  return res.status(204).end();
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface Pagination {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

// All list endpoints share this contract: ?page=1&pageSize=20 (bounded).
export function parsePagination(req: Request): Pagination {
  const page = Math.max(1, Number(req.query.page) || 1);
  const rawSize = Number(req.query.pageSize) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(Math.max(1, rawSize), MAX_PAGE_SIZE);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function paginated<T>(
  data: T[],
  meta: Omit<PaginationMeta, 'total' | 'totalPages'> & { total: number },
) {
  return {
    data,
    meta: {
      ...meta,
      totalPages: Math.max(1, Math.ceil(meta.total / meta.pageSize)),
    } satisfies PaginationMeta,
  };
}
