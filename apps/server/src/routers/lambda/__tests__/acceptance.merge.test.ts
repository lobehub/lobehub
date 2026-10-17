// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import { acceptances } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as GoalModelModule from '@/database/models/goal';

import { acceptanceRouter } from '../acceptance';
import { cleanupTestUser, createTestContext, createTestUser } from './integration/setup';

let serverDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => serverDB }));

/** The acceptance a batch is held on, as its goal's rollout state names it. */
const held = vi.hoisted(() => ({ acceptanceId: '' }));
vi.mock('@/database/models/goal', async (importOriginal) => {
  const actual = await importOriginal<typeof GoalModelModule>();
  class GoalModel extends actual.GoalModel {
    findByNode = async () =>
      ({
        config: {
          rolloutState: { phase: 'release_review', releaseGateAcceptanceId: held.acceptanceId },
        },
      }) as any;
  }
  return { ...actual, GoalModel };
});

describe('acceptanceRouter merge', () => {
  let userId: string;

  const insert = async (subjectType: 'goal_gate' | 'standalone') => {
    const [row] = await serverDB
      .insert(acceptances)
      .values({ status: 'delivered', subjectId: randomUUID(), subjectType, userId })
      .returning();
    return row.id;
  };

  beforeEach(async () => {
    serverDB = await getTestDB();
    userId = await createTestUser(serverDB);
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
  });

  it('refuses to fold another report into the one a batch is held on', async () => {
    const gateId = await insert('goal_gate');
    const otherId = await insert('standalone');
    held.acceptanceId = gateId;
    const caller = acceptanceRouter.createCaller(createTestContext(userId));

    await expect(caller.merge({ sourceId: otherId, targetId: gateId })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    // Nothing moved: the source report still stands on its own.
    const [source] = await serverDB.select().from(acceptances).where(eq(acceptances.id, otherId));
    expect(source).toBeDefined();
  });
});
