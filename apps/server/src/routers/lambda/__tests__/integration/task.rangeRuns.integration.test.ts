// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { tasks, taskTopics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
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

describe('Task Router list runsBetween', () => {
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

  const NOVEMBER = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-12-01T00:00:00Z') };

  it('attaches the runs started inside the window, with their notes', async () => {
    const digest = (
      await caller.create({
        automationMode: 'schedule',
        instruction: 'Inbox digest',
        schedulePattern: '0 9 * * *',
        scheduleTimezone: 'UTC',
      })
    ).data;
    const topicModel = new TaskTopicModel(serverDB, userId);
    for (const [seq, at] of [
      [1, '2026-10-30T09:00:00Z'],
      [2, '2026-11-02T09:00:00Z'],
    ] as const) {
      const topicId = await createTestTopic(serverDB, userId);
      await topicModel.add(digest.id, topicId, { seq, trigger: 'schedule' });
      await topicModel.updateStatus(digest.id, topicId, 'completed');
      await topicModel.updateHandoff(digest.id, topicId, { title: `Run ${seq} done` });
      await serverDB
        .update(taskTopics)
        .set({ createdAt: new Date(at) })
        .where(eq(taskTopics.topicId, topicId));
    }

    const list = await caller.list({ automated: true, runsBetween: NOVEMBER });

    expect(list.data[0].rangeRuns).toEqual([
      expect.objectContaining({ note: 'Run 2 done', seq: 2, status: 'completed' }),
    ]);
    expect(list.rangeRunsTruncated).toBe(false);
    // `runsBetween` alone does not opt into the scheduled table's fields.
    expect(list.data[0]).not.toHaveProperty('recentRuns');
  });

  it('flags a schedule held by an unanswered urgent brief, so the calendar plans nothing', async () => {
    const held = (
      await caller.create({
        automationMode: 'schedule',
        instruction: 'Held on a question',
        schedulePattern: '0 9 * * *',
        scheduleTimezone: 'UTC',
      })
    ).data;
    await new BriefModel(serverDB, userId).create({
      priority: 'urgent',
      summary: 'Which channel?',
      taskId: held.id,
      title: 'Needs an answer',
      type: 'decision',
    });

    const list = await caller.list({ automated: true, runsBetween: NOVEMBER });

    expect(list.data[0]).toMatchObject({ awaitingHuman: true, rangeRuns: [] });
  });

  it('accepts a six-week grid that gains an hour at a daylight-saving rollback', async () => {
    // October 2026 in America/New_York: Sep 27 00:00 EDT to Nov 8 00:00 EST, 1009 hours.
    const list = await caller.list({
      runsBetween: {
        from: new Date('2026-09-27T04:00:00Z'),
        to: new Date('2026-11-08T05:00:00Z'),
      },
    });

    expect(list.success).toBe(true);
  });

  it('rejects a backward window and one longer than a month grid', async () => {
    await expect(
      caller.list({ runsBetween: { from: NOVEMBER.to, to: NOVEMBER.from } }),
    ).rejects.toThrow();
    await expect(
      caller.list({
        runsBetween: { from: new Date('2026-01-01T00:00:00Z'), to: NOVEMBER.to },
      }),
    ).rejects.toThrow();
  });

  it('narrows completed tasks to those completed inside completedBetween', async () => {
    const complete = async (instruction: string, at: string) => {
      const task = (await caller.create({ instruction })).data;
      await serverDB
        .update(tasks)
        .set({ completedAt: new Date(at), status: 'completed' })
        .where(eq(tasks.id, task.id));
      return task.id;
    };
    const inside = await complete('Inside', '2026-11-05T10:00:00Z');
    await complete('Before', '2026-10-31T23:00:00Z');
    await complete('On the end bound', '2026-12-01T00:00:00Z');
    await caller.create({ instruction: 'Never completed' });

    const list = await caller.list({ completedBetween: NOVEMBER, statuses: ['completed'] });

    expect(list.data.map((task) => task.id)).toEqual([inside]);
    expect(list.total).toBe(1);
  });

  it('leaves rangeRuns off rows of a list that did not ask', async () => {
    await caller.create({ instruction: 'Plain task' });

    const list = await caller.list({});

    expect(list.data[0]).not.toHaveProperty('rangeRuns');
  });
});
