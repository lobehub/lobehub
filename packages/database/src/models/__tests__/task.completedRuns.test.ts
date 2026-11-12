// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { reconcileCompletedTaskRuns } from '@/server/services/taskLifecycle/reconcileCompleted';

import { getTestDB } from '../../core/getTestDB';
import { TaskRunClaimRepo } from '../../repositories/taskRunClaim';
import { agentOperations, tasks, taskTopics, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';

const db: LobeChatDatabase = await getTestDB();
const userId = 'completed-runs-test-user';
const staleBefore = new Date('2026-10-02T15:00:00Z');
const longAgo = new Date('2026-10-02T14:00:00Z');
let seq = 0;

interface SeedOptions {
  endedAt?: Date;
  operationStatus?:
    'abandoned' | 'done' | 'error' | 'interrupted' | 'running' | 'waiting_for_human';
  parentOperationId?: string;
  runStatus?: string;
  taskStatus?: string;
  withOperation?: boolean;
}

const seed = async (options: SeedOptions = {}) => {
  seq += 1;
  const taskId = `completed-task-${seq}`;
  const topicId = `completed-topic-${seq}`;
  const operationId = `completed-operation-${seq}`;
  await db.insert(tasks).values({
    createdByUserId: userId,
    id: taskId,
    identifier: `T-${seq}`,
    instruction: 'Complete the placeholder task',
    seq,
    status: options.taskStatus ?? 'running',
  });
  await db.insert(topics).values({ id: topicId, userId });
  await db.insert(taskTopics).values({
    operationId: options.withOperation === false ? undefined : operationId,
    seq: 1,
    status: options.runStatus ?? 'running',
    taskId,
    topicId,
    userId,
  });
  if (options.withOperation !== false) {
    await db.insert(agentOperations).values({
      completedAt: options.endedAt ?? longAgo,
      id: operationId,
      parentOperationId: options.parentOperationId,
      status: options.operationStatus ?? 'done',
      taskId,
      topicId,
      updatedAt: options.endedAt ?? longAgo,
      userId,
    });
  }
  return { operationId, taskId, topicId };
};

const find = () => TaskModel.findCompletedRunningTopics(db, { staleBefore });
const readRun = async (topicId: string) =>
  (await db.select().from(taskTopics).where(eq(taskTopics.topicId, topicId)).limit(1))[0];
const readTopic = async (topicId: string) =>
  (await db.select().from(topics).where(eq(topics.id, topicId)).limit(1))[0];

beforeEach(async () => {
  await db.delete(agentOperations);
  await db.delete(taskTopics);
  await db.delete(topics);
  await db.delete(tasks);
  await db.delete(users);
  seq = 0;
  await db.insert(users).values({ id: userId });
});
afterEach(async () => {
  await db.delete(agentOperations);
  await db.delete(users);
});

describe('completed Task run recovery', () => {
  it.each(['running', 'failed', 'paused', 'canceled', 'completed'])(
    'settles the successful run without changing its %s Task',
    async (taskStatus) => {
      const { taskId, topicId } = await seed({ taskStatus });
      const before = await db.select().from(tasks).where(eq(tasks.id, taskId));
      expect(await reconcileCompletedTaskRuns(db, { staleBefore })).toEqual({
        checked: 1,
        converged: [topicId],
        failed: [],
        skipped: [],
      });
      expect((await readRun(topicId)).status).toBe('completed');
      expect(await readTopic(topicId)).toMatchObject({
        completedAt: expect.any(Date),
        status: 'completed',
      });
      expect(await db.select().from(tasks).where(eq(tasks.id, taskId))).toEqual(before);
      expect(await reconcileCompletedTaskRuns(db, { staleBefore })).toEqual({
        checked: 0,
        converged: [],
        failed: [],
        skipped: [],
      });
    },
  );

  it('leaves recent completions, non-success outcomes and settled rows alone', async () => {
    await seed({ endedAt: staleBefore });
    await seed({ endedAt: new Date(staleBefore.getTime() + 1) });
    for (const operationStatus of [
      'error',
      'abandoned',
      'interrupted',
      'running',
      'waiting_for_human',
    ] as const) {
      await seed({ operationStatus });
    }
    await seed({ runStatus: 'completed' });
    await seed({ runStatus: 'canceled' });
    await seed({ withOperation: false });
    expect(await find()).toEqual([]);
  });

  it('does not settle a child operation or a topic with a live follow-up', async () => {
    const parent = await seed({ operationStatus: 'running' });
    await seed({ parentOperationId: parent.operationId });
    const previous = await seed();
    await db.insert(agentOperations).values({
      id: 'completed-live-follow-up',
      status: 'running',
      topicId: previous.topicId,
      userId,
    });
    expect(await find()).toEqual([]);
  });

  it('uses updatedAt when the legacy operation has no completedAt', async () => {
    const { operationId, topicId } = await seed();
    await db
      .update(agentOperations)
      .set({ completedAt: null, updatedAt: longAgo })
      .where(eq(agentOperations.id, operationId));
    expect(await find()).toEqual([expect.objectContaining({ operationId, topicId })]);
  });

  it('bounds each sweep and drains remaining successful runs on the next pass', async () => {
    await seed();
    await seed();
    expect(
      (await reconcileCompletedTaskRuns(db, { limit: 1, staleBefore })).converged,
    ).toHaveLength(1);
    expect(
      (await reconcileCompletedTaskRuns(db, { limit: 1, staleBefore })).converged,
    ).toHaveLength(1);
    expect(await find()).toEqual([]);
  });

  it('cannot overwrite a newer operation that takes over after discovery', async () => {
    const { operationId, topicId } = await seed();
    expect(await find()).toHaveLength(1);
    await db
      .update(taskTopics)
      .set({ operationId: 'new-operation' })
      .where(eq(taskTopics.topicId, topicId));
    expect(await new TaskRunClaimRepo(db, userId).claim(topicId, operationId, 'completed')).toBe(
      false,
    );
    expect(await readRun(topicId)).toMatchObject({
      operationId: 'new-operation',
      status: 'running',
    });
    expect((await readTopic(topicId)).completedAt).toBeNull();
  });
});
