// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, tasks, taskTopics, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';
import { TaskTopicModel } from '../taskTopic';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'orphaned-runs-test-user-id';

/** Every fixture ends before this, so the grace window never hides one. */
const staleBefore = new Date('2026-10-02T15:00:00Z');
const longAgo = new Date('2026-10-02T14:00:00Z');

let seq = 0;

interface SeedOptions {
  /** When the operation ended. Defaults to well before the window. */
  endedAt?: Date;
  operationStatus?:
    'abandoned' | 'done' | 'error' | 'interrupted' | 'running' | 'waiting_for_human';
  /** Set to make the operation a sub-agent child. */
  parentOperationId?: string;
  /** The run row's status; `running` is the one this net looks for. */
  runStatus?: string;
  taskStatus?: string;
  /** Omit to seed a run row with no operation behind it. */
  withOperation?: boolean;
}

/** One Task with one run of it, plus the operation behind that run. */
const seed = async (options: SeedOptions = {}) => {
  seq += 1;
  const taskId = `task-${seq}`;
  const topicId = `tpc-${seq}`;
  const operationId = `op-${seq}`;

  await serverDB.insert(tasks).values({
    createdByUserId: userId,
    id: taskId,
    identifier: `T-${seq}`,
    instruction: 'do the thing',
    seq,
    status: options.taskStatus ?? 'running',
  });
  await serverDB.insert(topics).values({ id: topicId, userId });
  await serverDB.insert(taskTopics).values({
    operationId: options.withOperation === false ? undefined : operationId,
    seq: 1,
    status: options.runStatus ?? 'running',
    taskId,
    topicId,
    userId,
  });

  if (options.withOperation !== false) {
    await serverDB.insert(agentOperations).values({
      completedAt: options.endedAt ?? longAgo,
      id: operationId,
      parentOperationId: options.parentOperationId,
      status: options.operationStatus ?? 'error',
      taskId,
      topicId,
      userId,
      updatedAt: options.endedAt ?? longAgo,
    });
  }

  return { operationId, taskId, topicId };
};

const find = () => TaskModel.findOrphanedRunningTopics(serverDB, { staleBefore });

const readRun = async (topicId: string) =>
  (await serverDB.select().from(taskTopics).where(eq(taskTopics.topicId, topicId)).limit(1))[0];

const readTopic = async (topicId: string) =>
  (await serverDB.select().from(topics).where(eq(topics.id, topicId)).limit(1))[0];

beforeEach(async () => {
  // `agent_operations.userId` is deliberately not a foreign key, so deleting the
  // user does not cascade it away.
  await serverDB.delete(agentOperations);
  await serverDB.delete(taskTopics);
  await serverDB.delete(topics);
  await serverDB.delete(tasks);
  await serverDB.delete(users);
  seq = 0;
  await serverDB.insert(users).values([{ id: userId }]);
});

afterEach(async () => {
  await serverDB.delete(agentOperations);
  await serverDB.delete(users);
});

describe('TaskModel.findOrphanedRunningTopics', () => {
  it('returns a running Task run whose operation already ended', async () => {
    const { operationId, taskId, topicId } = await seed({ operationStatus: 'abandoned' });

    const rows = await find();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operationId,
      operationStatus: 'abandoned',
      taskId,
      taskIdentifier: 'T-1',
      topicId,
      userId,
    });
  });

  it('ignores an operation that has not settled', async () => {
    await seed({ operationStatus: 'running' });
    await seed({ operationStatus: 'waiting_for_human' });

    expect(await find()).toHaveLength(0);
  });

  it('ignores a run that succeeded and one the user interrupted', async () => {
    // `done` needs the success path's own inputs to settle and `interrupted`
    // belongs to the interrupt path: settling either from here would mislabel
    // the outcome, so this net must not see them at all.
    await seed({ operationStatus: 'done' });
    await seed({ operationStatus: 'interrupted' });

    expect(await find()).toHaveLength(0);
  });

  it('ignores an operation that ended inside the grace window', async () => {
    await seed({ endedAt: new Date('2026-10-02T16:00:00Z') });

    expect(await find()).toHaveLength(0);
  });

  it('ignores a run whose Task already left `running`', async () => {
    await seed({ taskStatus: 'paused' });

    expect(await find()).toHaveLength(0);
  });

  it('ignores a run row that was already settled', async () => {
    await seed({ runStatus: 'failed' });

    expect(await find()).toHaveLength(0);
  });

  it('ignores a run row with no operation behind it', async () => {
    await seed({ withOperation: false });

    expect(await find()).toHaveLength(0);
  });

  it('ignores a sub-agent child operation', async () => {
    await seed({ parentOperationId: 'op-parent' });

    expect(await find()).toHaveLength(0);
  });

  it('lists every orphaned run, oldest first, capped by the limit', async () => {
    // Seeded out of order so the returned order can only come from the query.
    const newest = await seed({ endedAt: new Date('2026-10-02T14:30:00Z') });
    const oldest = await seed({ endedAt: new Date('2026-10-02T14:00:00Z') });
    const middle = await seed({ endedAt: new Date('2026-10-02T14:15:00Z') });

    const all = await TaskModel.findOrphanedRunningTopics(serverDB, { staleBefore });
    expect(all.map((row) => row.operationId)).toEqual([
      oldest.operationId,
      middle.operationId,
      newest.operationId,
    ]);

    const capped = await TaskModel.findOrphanedRunningTopics(serverDB, { limit: 2, staleBefore });
    expect(capped).toHaveLength(2);
  });
});

describe('TaskTopicModel run claim', () => {
  it('flips a run that still names its own operation out of `running`', async () => {
    const { operationId, topicId } = await seed();
    const model = new TaskTopicModel(serverDB, userId);

    expect(await model.markEndedIfRunning(topicId, operationId, 'failed')).toBe(true);

    expect((await readRun(topicId)).status).toBe('failed');
    // The run is over, so the topic gets its end stamp too.
    expect((await readTopic(topicId)).completedAt).toBeInstanceOf(Date);
  });

  it('refuses a run that has already settled', async () => {
    const { operationId, topicId } = await seed({ runStatus: 'failed' });
    const model = new TaskTopicModel(serverDB, userId);

    expect(await model.markEndedIfRunning(topicId, operationId, 'failed')).toBe(false);
  });

  it('refuses a run a newer operation has taken over', async () => {
    const { topicId } = await seed();
    const model = new TaskTopicModel(serverDB, userId);

    expect(await model.markEndedIfRunning(topicId, 'op-someone-else', 'failed')).toBe(false);
    expect((await readRun(topicId)).status).toBe('running');
  });

  it('hands its own run back when the settle it was claimed for failed', async () => {
    const { operationId, topicId } = await seed();
    const model = new TaskTopicModel(serverDB, userId);
    await model.markEndedIfRunning(topicId, operationId, 'failed');

    expect(await model.reopenEndedRun(topicId, operationId, 'failed')).toBe(true);
    expect((await readRun(topicId)).status).toBe('running');
    expect((await readTopic(topicId)).completedAt).toBeNull();
  });

  it('never re-opens a run that is no longer the claimed one', async () => {
    const { operationId, topicId } = await seed();
    const model = new TaskTopicModel(serverDB, userId);
    await model.markEndedIfRunning(topicId, operationId, 'failed');

    expect(await model.reopenEndedRun(topicId, 'op-someone-else', 'failed')).toBe(false);
    expect((await readRun(topicId)).status).toBe('failed');
  });
});
