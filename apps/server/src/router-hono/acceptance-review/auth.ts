import { siteOriginMatches } from '@lobechat/utils/siteOrigin';
import type { MiddlewareHandler } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { verifyAcceptanceReviewJWT } from '@/libs/oidc-provider/jwt';
import type { ReviewAccess } from '@/server/services/acceptanceReview/access';
import { resolveReviewAccess } from '@/server/services/acceptanceReview/access';
import type { ProjectReviewRole } from '@/server/services/acceptanceReview/projectAccess';
import {
  findProjectReviewScope,
  resolveProjectReviewRole,
} from '@/server/services/acceptanceReview/projectAccess';
import { findSiteForOrigin } from '@/server/services/projectReview/sites';

import { reviewError } from './errors';

export interface ReviewEnv {
  Variables: {
    access: ReviewAccess;
    db: LobeChatDatabase;
    expiresAt: number;
    project?: { id: string; name: string };
    role?: ProjectReviewRole | null;
    site?: { id: string; name: string };
    userId: string;
  };
}

// Browsers omit Origin on same-origin GETs, which is every read the toolbar
// makes when the reviewed site is the LobeHub app itself.
const requestOrigin = (origin: string | undefined, fetchSite: string | undefined) => {
  if (origin) return origin;
  if (fetchSite !== 'same-origin' || !appEnv.APP_URL) return undefined;
  try {
    return new URL(appEnv.APP_URL).origin;
  } catch {
    return undefined;
  }
};

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

  if (claims.site) {
    const origin = requestOrigin(c.req.header('origin'), c.req.header('sec-fetch-site'));
    if (!origin || !siteOriginMatches(claims.site.origin, origin)) {
      return reviewError(c, 403, 'FORBIDDEN', 'Origin not allowed for this token');
    }
    const site = await findSiteForOrigin(db, claims.site.siteId, claims.site.origin);
    if (!site?.acceptanceId) return reviewError(c, 404, 'SITE_GONE', 'Site not found');
    const access = await resolveReviewAccess(db, claims.userId, site.acceptanceId);
    if (!access?.can.comment)
      return reviewError(c, 403, 'SITE_ACCESS_REVOKED', 'No access to this site');
    const project = await findProjectReviewScope(db, site.projectId);
    c.set('access', access);
    c.set('project', project ? { id: project.id, name: project.name } : undefined);
    c.set('role', project ? await resolveProjectReviewRole(db, claims.userId, project) : null);
    c.set('site', { id: site.id, name: site.name });
  } else {
    const access = claims.acceptanceId
      ? await resolveReviewAccess(db, claims.userId, claims.acceptanceId)
      : null;
    if (!access) return reviewError(c, 404, 'NOT_FOUND', 'Acceptance not found');
    c.set('access', access);
  }

  c.set('db', db);
  c.set('expiresAt', claims.expiresAt ?? 0);
  c.set('userId', claims.userId);
  await next();
};
