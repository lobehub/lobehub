import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { ProjectSiteModel } from '@/database/models/projectReview';
import { findProjectReviewScope } from '@/server/services/acceptanceReview/projectAccess';

import { reviewError } from './errors';

export const getSiteInfo = async (c: Context) => {
  const db = await getServerDB();
  const site = await new ProjectSiteModel(db).findById(c.req.param('siteId') ?? '');
  const project = site ? await findProjectReviewScope(db, site.projectId) : null;
  if (!site || !project) return reviewError(c, 404, 'NOT_FOUND', 'Site not found');
  return c.json({ name: site.name, project: { name: project.name } });
};
