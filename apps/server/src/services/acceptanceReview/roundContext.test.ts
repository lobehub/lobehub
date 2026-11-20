// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { acceptanceReviews, projects } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectSiteModel } from '@/database/models/projectReview';
import {
  cleanupTestUser,
  createTestUser,
} from '@/server/routers/lambda/__tests__/integration/setup';

import { countRound } from './roundContext';

describe('countRound', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let siteId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    userId = await createTestUser(serverDB);
    const [project] = await serverDB
      .insert(projects)
      .values({ name: 'Website', userId })
      .returning();
    siteId = (
      await new ProjectSiteModel(serverDB).create({
        name: 'Website',
        origins: ['https://website.example'],
        projectId: project.id,
      })
    ).id;
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
  });

  const submittedAt = async (at: string) => {
    const [row] = await serverDB
      .insert(acceptanceReviews)
      .values({ siteId, status: 'submitted', submittedAt: sql`${at}::timestamptz`, userId })
      .returning();
    return row;
  };

  it('counts a round whose stored time has more precision than a JavaScript date', async () => {
    await submittedAt('2026-11-12 15:07:48.123456+00');
    const second = await submittedAt('2026-11-12 15:10:35.654321+00');

    expect(await countRound(serverDB, second)).toBe(2);
  });

  it('does not count rounds submitted after this one or by someone else', async () => {
    const first = await submittedAt('2026-11-12 15:07:48.123456+00');
    await submittedAt('2026-11-12 15:10:35.654321+00');
    const other = await createTestUser(serverDB);
    await serverDB
      .update(acceptanceReviews)
      .set({ userId: other })
      .where(eq(acceptanceReviews.id, (await submittedAt('2026-11-12 15:00:00.000001+00')).id));

    expect(await countRound(serverDB, first)).toBe(1);
    await cleanupTestUser(serverDB, other);
  });
});
