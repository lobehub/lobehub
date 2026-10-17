import type { MiddlewareHandler } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import type { LobeChatDatabase } from '@/database/type';
import { verifyAcceptanceReviewJWT } from '@/libs/oidc-provider/jwt';
import type { ReviewAccess } from '@/server/services/acceptanceReview/access';
import { resolveReviewAccess } from '@/server/services/acceptanceReview/access';

import { reviewError } from './errors';

export interface ReviewEnv {
  Variables: {
    access: ReviewAccess;
    db: LobeChatDatabase;
    expiresAt: number;
    userId: string;
  };
}

export const reviewAuth: MiddlewareHandler<ReviewEnv> = async (c, next) => {
  const token = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return reviewError(c, 401, 'UNAUTHORIZED', 'Missing token');

  let claims: Awaited<ReturnType<typeof verifyAcceptanceReviewJWT>>;
  try {
    claims = await verifyAcceptanceReviewJWT(token);
  } catch {
    return reviewError(c, 401, 'UNAUTHORIZED', 'Invalid token');
  }

  // The token outlives a visibility change, so read access is re-checked on
  // every request rather than trusted from consent time.
  const db = await getServerDB();
  const access = await resolveReviewAccess(db, claims.userId, claims.acceptanceId);
  if (!access) return reviewError(c, 404, 'NOT_FOUND', 'Acceptance not found');

  c.set('access', access);
  c.set('db', db);
  c.set('expiresAt', claims.expiresAt ?? 0);
  c.set('userId', claims.userId);
  await next();
};
