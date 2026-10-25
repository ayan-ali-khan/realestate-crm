// Auth service: all business logic lives here (controllers stay thin).
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { ConflictError, UnauthorizedError } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../lib/tokens.js';
import { env } from '../../config/env.js';
import type { Role, User } from '../../generated/prisma/client.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';

const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} as const;
export type SafeUser = Pick<User, keyof typeof SAFE_USER_SELECT>;

// '15m' / '7d' -> milliseconds; keeps TTL config human in .env.
const DURATION_RE = /^(\d+)(s|m|h|d)$/;
export function durationMs(value: string): number {
  const match = DURATION_RE.exec(value);
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new Error(`Invalid duration: ${value}`);
  }
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  const unit = match[2] as keyof typeof unitMs;
  return Number(match[1]) * unitMs[unit];
}

const secureCookies = () => env.NODE_ENV === 'production';

// SameSite policy: development/test keep Lax (localhost is one site — the
// browser sends the cookie to :4000 from :3000 without help). Production is
// None so a split-domain deploy (web on one host, API on another — e.g.
// Vercel + Render) still receives the session cookie; None is only legal
// together with Secure, which secureCookies() guarantees in production.
// Cross-site mutations stay safe regardless: every write requires a JSON
// body, and a cross-origin JSON fetch triggers a CORS preflight that only
// CORS_ORIGINS passes (see ADR-007).
const sameSitePolicy = () => (secureCookies() ? ('none' as const) : ('lax' as const));

async function issueSession(user: Pick<User, 'id' | 'role'>, res: Response): Promise<void> {
  const jti = randomUUID();
  const refreshTtlMs = durationMs(env.REFRESH_TOKEN_TTL);

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(jti),
      userId: user.id,
      expiresAt: new Date(Date.now() + refreshTtlMs),
    },
  });
  // The stored value is a hash of the jti claim, not the raw JWT: the DB never
  // contains anything that can be replayed directly.
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ sub: user.id, role: user.role }),
    signRefreshToken({ sub: user.id, role: user.role, jti }),
  ]);

  const base = { httpOnly: true, sameSite: sameSitePolicy(), secure: secureCookies() };
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...base,
    path: '/',
    maxAge: durationMs(env.ACCESS_TOKEN_TTL),
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base,
    path: '/api/v1/auth',
    maxAge: refreshTtlMs,
  });
}

export async function register(input: RegisterInput, res: Response): Promise<SafeUser> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ConflictError('An account with this email already exists');

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: 'AGENT',
    },
    select: SAFE_USER_SELECT,
  });
  await issueSession(user, res);
  return user;
}

export async function login(input: LoginInput, res: Response): Promise<SafeUser> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Same message for "no such user" and "wrong password": no user enumeration.
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new UnauthorizedError('Invalid email or password');
  }
  const safe = await prisma.user.update({
    where: { id: user.id },
    data: {},
    select: SAFE_USER_SELECT,
  });
  await issueSession(user, res);
  return safe;
}

export async function refresh(rawToken: string | undefined, res: Response): Promise<void> {
  if (!rawToken) throw new UnauthorizedError('Missing refresh token');
  let payload;
  try {
    payload = await verifyRefreshToken(rawToken);
  } catch {
    throw new UnauthorizedError('Invalid refresh token');
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(payload.jti) },
  });
  if (
    !stored ||
    stored.revokedAt ||
    stored.expiresAt < new Date() ||
    stored.userId !== payload.sub
  ) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  // Rotation: revoke the presented token and issue a fresh pair. A replay of
  // the old token then fails the revokedAt check above.
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  await issueSession({ id: payload.sub, role: payload.role }, res);
}

export async function logout(rawToken: string | undefined, res: Response): Promise<void> {
  if (rawToken) {
    try {
      const payload = await verifyRefreshToken(rawToken);
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(payload.jti), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Already invalid: logout must stay idempotent.
    }
  }
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
}

export async function me(userId: string): Promise<SafeUser> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: SAFE_USER_SELECT });
  if (!user) throw new UnauthorizedError();
  return user;
}

export type { Role };
