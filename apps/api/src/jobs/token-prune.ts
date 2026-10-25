// Phase 4 job: refresh-token rotation writes one RefreshToken row per login and
// per refresh (ADR-007) and nothing ever deleted them — unbounded growth. This
// nightly job bounds the table to ~one refresh-TTL window of logins.
//
// Only EXPIRED rows are removed. A revoked-but-unexpired token must stay: the
// refresh endpoint distinguishes "replayed after rotation" (row exists,
// revokedAt set) from "never existed", and that distinction is the replay
// signal (ADR-007). Once a row expires it can no longer authenticate anything,
// so deleting it loses nothing.
import { prisma } from '../lib/prisma.js';

export async function pruneExpiredRefreshTokens(
  now: Date = new Date(),
): Promise<{ deleted: number }> {
  const { count } = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return { deleted: count };
}
