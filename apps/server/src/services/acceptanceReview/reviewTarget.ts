import { acceptanceIdFromReviewResource, siteReviewFromResource } from '@lobechat/const';

import type { LobeChatDatabase } from '@/database/type';
import { findSiteForOrigin } from '@/server/services/projectReview/sites';

import { resolveReviewAccess } from './access';
import {
  findProjectReviewScope,
  type ProjectReviewRole,
  resolveProjectReviewRole,
} from './projectAccess';

export type ReviewTarget =
  | { allowed: false; kind: 'acceptance' }
  | { allowed: false; kind: 'site'; origin?: string; reason: 'noAccess' | 'unregistered' }
  | { allowed: true; kind: 'acceptance'; title?: string }
  | {
      allowed: true;
      kind: 'site';
      origin: string;
      projectName: string;
      role: ProjectReviewRole | null;
      siteName: string;
    };

export async function describeReviewTarget(
  db: LobeChatDatabase,
  userId: string | null | undefined,
  resource: unknown,
): Promise<ReviewTarget> {
  const indicator = Array.isArray(resource) ? resource[0] : resource;
  const site = siteReviewFromResource(indicator);

  if (site) {
    const record = await findSiteForOrigin(db, site.siteId, site.origin);
    if (!record) {
      return { allowed: false, kind: 'site', origin: site.origin, reason: 'unregistered' };
    }
    const access =
      userId && record.acceptanceId
        ? await resolveReviewAccess(db, userId, record.acceptanceId)
        : null;
    const project = access ? await findProjectReviewScope(db, record.projectId) : null;
    if (!access?.can.comment || !project)
      return { allowed: false, kind: 'site', reason: 'noAccess' };
    return {
      allowed: true,
      kind: 'site',
      origin: site.origin,
      projectName: project.name,
      role: await resolveProjectReviewRole(db, userId, project),
      siteName: record.name,
    };
  }

  const acceptanceId = acceptanceIdFromReviewResource(indicator);
  if (!userId || !acceptanceId) return { allowed: false, kind: 'acceptance' };
  const access = await resolveReviewAccess(db, userId, acceptanceId);
  if (!access) return { allowed: false, kind: 'acceptance' };
  return {
    allowed: true,
    kind: 'acceptance',
    title: access.acceptance.metadata?.title || access.acceptance.requirement || undefined,
  };
}
