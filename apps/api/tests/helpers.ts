import request from 'supertest';
import type { Express } from 'express';

// Manual cookie handling (vs agent) so tests can assert rotation semantics:
// capture an old token, replay it after rotation, expect 401.
export function cookieHeader(res: request.Response, name: string): string {
  const cookies = res.get('Set-Cookie') ?? [];
  const found = cookies.find((c) => c.startsWith(`${name}=`));
  if (!found) throw new Error(`Expected Set-Cookie for ${name}, got: ${cookies.join(' | ')}`);
  return found.split(';')[0] ?? '';
}

export function clearedCookie(res: request.Response, name: string): boolean {
  const cookies = res.get('Set-Cookie') ?? [];
  return cookies.some((c) => c.startsWith(`${name}=;`));
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
}

export const api = (app: Express) => request(app);
