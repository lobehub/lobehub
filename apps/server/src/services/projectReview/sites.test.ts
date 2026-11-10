// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectModel } from '@/database/models/project';
import { ProjectSiteModel } from '@/database/models/projectReview';
import {
  cleanupTestUser,
  createTestUser,
} from '@/server/routers/lambda/__tests__/integration/setup';

import { findSiteForOrigin } from './sites';

describe('findSiteForOrigin', () => {
  let db: LobeChatDatabase;
  let ownerId: string;
  let siteId: string;

  beforeEach(async () => {
    db = await getTestDB();
    ownerId = await createTestUser(db);
    const project = await new ProjectModel(db, ownerId).create({ identifier: 'SITE', name: 'F' });
    const site = await new ProjectSiteModel(db).create({
      name: 'Marketing',
      origins: ['https://fieldnotes.app', 'https://*.fieldnotes.app'],
      projectId: project.id,
    });
    siteId = site.id;
  });

  afterEach(async () => {
    await cleanupTestUser(db, ownerId);
  });

  it('returns the site when the origin is registered, exactly or by wildcard', async () => {
    expect(await findSiteForOrigin(db, siteId, 'https://fieldnotes.app')).toMatchObject({
      id: siteId,
    });
    expect(await findSiteForOrigin(db, siteId, 'https://pr-3.fieldnotes.app')).toMatchObject({
      id: siteId,
    });
  });

  it('returns null for an unregistered origin or an unknown site ID', async () => {
    expect(await findSiteForOrigin(db, siteId, 'https://fieldnotes-mirror.net')).toBeNull();
    expect(await findSiteForOrigin(db, 'psite_000000000000', 'https://fieldnotes.app')).toBeNull();
    expect(await findSiteForOrigin(db, siteId, undefined)).toBeNull();
  });
});
