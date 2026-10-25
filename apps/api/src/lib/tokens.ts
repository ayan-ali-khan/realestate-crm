// JWT issuing/verification with jose (ESM-native, maintained by the IETF
// JOSE working group). Access + refresh tokens use separate keys and TTLs so a
// leaked access token is useless after 15 minutes and cannot mint new tokens.
import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import type { Role } from '../generated/prisma/client.js';

export const ACCESS_COOKIE = 'crm_access';
export const REFRESH_COOKIE = 'crm_refresh';

const accessKey = new TextEncoder().encode(env.ACCESS_TOKEN_SECRET);
const refreshKey = new TextEncoder().encode(env.REFRESH_TOKEN_SECRET);

export interface TokenPayload {
  sub: string;
  role: Role;
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export async function signAccessToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(accessKey);
}

export async function signRefreshToken(payload: TokenPayload & { jti: string }): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setJti(payload.jti)
    .setIssuedAt()
    .setExpirationTime(env.REFRESH_TOKEN_TTL)
    .sign(refreshKey);
}

export async function verifyAccessToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, accessKey);
  if (!payload.sub || !payload.role) throw new Error('Malformed access token');
  return { sub: payload.sub, role: payload.role as Role };
}

export async function verifyRefreshToken(token: string): Promise<TokenPayload & { jti: string }> {
  const { payload } = await jwtVerify(token, refreshKey);
  if (!payload.sub || !payload.role || !payload.jti) throw new Error('Malformed refresh token');
  return { sub: payload.sub, role: payload.role as Role, jti: payload.jti };
}

// Refresh tokens are stored server-side as SHA-256 hashes: a database leak
// does not hand out usable tokens.
export function hashToken(token: string): string {
  return b64url(createHash('sha256').update(token).digest());
}
