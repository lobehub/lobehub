// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestUser, createTestUser } from '../__tests__/integration/setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

const scheduleWorktreeCleanup = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/worktreeCleanup', () => ({ scheduleWorktreeCleanup }));

const { topicRouter } = await import('./index');

/**
 * "Archive" in the UI is `updateTopic({ status: 'completed' })` — single, bulk
 * and "archive merged PRs" alike. That write is what starts the cleanup of the
 * worktree the app created for the topic, with the status it replaced.
 */
describe('topic.updateTopic archive → worktree cleanup', () => {
  let userId: string;

  beforeEach(async () => {
    testDB = await getTestDB();
    userId = await createTestUser(testDB);
  });

  afterEach(async () => {
    scheduleWorktreeCleanup.mockReset();
    await cleanupTestUser(testDB, userId);
  });

  const seed = async (status: 'active' | 'completed' | 'running') => {
    const [topic] = await testDB.insert(topics).values({ status, title: 't', userId }).returning();
    return topic.id;
  };

  it('schedules the cleanup with the previous status when a topic is archived', async () => {
    const id = await seed('running');
    const caller = topicRouter.createCaller({ userId } as any);

    await caller.updateTopic({ id, value: { completedAt: new Date(), status: 'completed' } });

    expect(scheduleWorktreeCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        previousStatus: { [id]: 'running' },
        topicIds: [id],
        trigger: 'archived',
        userId,
      }),
    );
  });

  it('does not schedule for other status writes or an already archived topic', async () => {
    const active = await seed('active');
    const archived = await seed('completed');
    const caller = topicRouter.createCaller({ userId } as any);

    await caller.updateTopic({ id: active, value: { status: 'unread' } });
    await caller.updateTopic({ id: active, value: { title: 'renamed' } });
    await caller.updateTopic({ id: archived, value: { status: 'completed' } });

    expect(scheduleWorktreeCleanup).not.toHaveBeenCalled();
  });
});
