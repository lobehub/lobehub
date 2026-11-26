// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BriefModel } from '@/database/models/brief';
import { TaskTopicModel } from '@/database/models/taskTopic';

import { taskRouter } from '../../task';
import { cleanupTestUser, createTestContext, createTestTopic, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

describe('Task Router list recentRuns', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let caller: ReturnType<typeof taskRouter.createCaller>;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    caller = taskRouter.createCaller(createTestContext(userId));
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
  });

  const createScheduled = async (instruction: string) =>
    (
      await caller.create({
        automationMode: 'schedule',
        instruction,
        schedulePattern: '0 9 * * *',
        scheduleTimezone: 'UTC',
      })
    ).data;

  it('attaches the latest runs and the awaiting-human flag when asked', async () => {
    const digest = await createScheduled('Daily digest');
    const blocked = await createScheduled('Blocked on a question');

    const topicModel = new TaskTopicModel(serverDB, userId);
    for (const seq of [1, 2, 3]) {
      const topicId = await createTestTopic(serverDB, userId);
      await topicModel.add(digest.id, topicId, { seq, trigger: 'schedule' });
      await topicModel.updateStatus(digest.id, topicId, seq === 2 ? 'failed' : 'completed');
    }
    await new BriefModel(serverDB, userId).create({
      priority: 'urgent',
      summary: 'Which channel?',
      taskId: blocked.id,
      title: 'Needs an answer',
      type: 'decision',
    });

    const list = await caller.list({ automated: true, recentRuns: 2 });
    const byId = new Map(list.data.map((task) => [task.id, task]));

    expect(byId.get(digest.id)?.recentRuns?.map((run) => [run.seq, run.status])).toEqual([
      [3, 'completed'],
      [2, 'failed'],
    ]);
    expect(byId.get(digest.id)?.awaitingHuman).toBe(false);
    expect(byId.get(blocked.id)?.recentRuns).toEqual([]);
    expect(byId.get(blocked.id)?.awaitingHuman).toBe(true);
  });

  it('leaves both fields off rows of a list that did not ask', async () => {
    await createScheduled('Daily digest');

    const list = await caller.list({ automated: true });

    expect(list.data).toHaveLength(1);
    expect(list.data[0]).not.toHaveProperty('recentRuns');
    expect(list.data[0]).not.toHaveProperty('awaitingHuman');
  });
});
