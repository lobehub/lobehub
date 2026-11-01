// @vitest-environment node
import { siteReviewResource } from '@lobechat/const';
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectModel } from '@/database/models/project';
import {
  cleanupTestUser,
  createTestUser,
} from '@/server/routers/lambda/__tests__/integration/setup';
import { ProjectReviewService } from '@/server/services/projectReview';

import { describeReviewTarget } from './reviewTarget';

describe('describeReviewTarget for sites', () => {
  let db: LobeChatDatabase;
  let ownerId: string;
  let strangerId: string;
  let siteId: string;

  beforeEach(async () => {
    db = await getTestDB();
    ownerId = await createTestUser(db);
    strangerId = await createTestUser(db);
    const project = await new ProjectModel(db, ownerId).create({
      identifier: 'SITE',
      name: 'Fieldnotes 官网',
    });
    const site = await new ProjectReviewService(db, ownerId).createSite(project.id, {
      name: 'Marketing site',
      origins: ['https://fieldnotes.app'],
    });
    siteId = site.id;
  });

  afterEach(async () => {
    await cleanupTestUser(db, strangerId);
    await cleanupTestUser(db, ownerId);
  });

  it('names the site, project, origin and role for someone who may review it', async () => {
    expect(
      await describeReviewTarget(db, ownerId, siteReviewResource(siteId, 'https://fieldnotes.app')),
    ).toEqual({
      allowed: true,
      kind: 'site',
      origin: 'https://fieldnotes.app',
      projectName: 'Fieldnotes 官网',
      role: 'admin',
      siteName: 'Marketing site',
    });
  });

  it('refuses someone outside the project without naming the site', async () => {
    expect(
      await describeReviewTarget(
        db,
        strangerId,
        siteReviewResource(siteId, 'https://fieldnotes.app'),
      ),
    ).toEqual({ allowed: false, kind: 'site', reason: 'noAccess' });
  });

  it('refuses an origin the site does not list', async () => {
    expect(
      await describeReviewTarget(
        db,
        ownerId,
        siteReviewResource(siteId, 'https://fieldnotes-mirror.net'),
      ),
    ).toEqual({
      allowed: false,
      kind: 'site',
      origin: 'https://fieldnotes-mirror.net',
      reason: 'unregistered',
    });
  });

  it('refuses a missing user', async () => {
    expect(
      await describeReviewTarget(db, null, siteReviewResource(siteId, 'https://fieldnotes.app')),
    ).toEqual({ allowed: false, kind: 'site', reason: 'noAccess' });
  });
});
