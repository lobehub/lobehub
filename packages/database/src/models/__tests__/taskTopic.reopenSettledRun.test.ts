// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { tasks, taskTopics, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskTopicModel } from '../taskTopic';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-topic-reopen-test-user-id';
const taskId = 'task-reopen-1';
const topicId = 'tpc-reopen-1';

const readRun = async () =>
  (await serverDB.select().from(taskTopics).where(eq(taskTopics.topicId, topicId)).limit(1))[0];

const readTopic = async () =>
  (await serverDB.select().from(topics).where(eq(topics.id, topicId)).limit(1))[0];

/** A Task whose run already finished: the state the user answers from. */
const seed = async ({ runStatus = 'completed', operationId = 'op-original' } = {}) => {
  await serverDB.insert(tasks).values({
    createdByUserId: userId,
    id: taskId,
    identifier: 'T-1',
    instruction: 'do the thing',
    seq: 1,
    status: 'completed',
  });
  await serverDB.insert(topics).values({
    completedAt: new Date('2026-10-02T10:00:00Z'),
    id: topicId,
    status: 'completed',
    userId,
  });
  await serverDB.insert(taskTopics).values({
    operationId,
    seq: 1,
    status: runStatus,
    taskId,
    topicId,
    userId,
  });
};

describe('TaskTopicModel.reopenSettledRun', () => {
  beforeEach(async () => {
    await serverDB.delete(taskTopics);
    await serverDB.delete(topics);
    await serverDB.delete(tasks);
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }]);
  });

  afterEach(async () => {
    await serverDB.delete(taskTopics);
    await serverDB.delete(users);
  });

  it('puts a settled run back in flight under the answering operation', async () => {
    await seed();
    const model = new TaskTopicModel(serverDB, userId);

    expect(await model.reopenSettledRun(topicId, 'op-answer')).toBe(true);

    const run = await readRun();
    expect(run).toMatchObject({ operationId: 'op-answer', status: 'running' });
    // A user replying in the run's conversation is not an automation tick, and
    // only ticks may spend the attempt budget.
    expect(run.trigger).toBe('manual');
  });

  it('keeps the live run’s operation id when a message lands behind it', async () => {
    // The row is already `running`: this message joins the run in flight, and
    // the row must keep naming the operation that cancellation interrupts.
    await seed({ operationId: 'op-live', runStatus: 'running' });
    const model = new TaskTopicModel(serverDB, userId);

    expect(await model.reopenSettledRun(topicId, 'op-queued')).toBe(false);

    expect(await readRun()).toMatchObject({ operationId: 'op-live', status: 'running' });
  });

  it('reopens a run the sweep settled as failed', async () => {
    // Every terminal outcome reopens the same way — the point is that the row
    // is no longer live, not which way it ended.
    await seed({ operationId: 'op-lost', runStatus: 'failed' });

    expect(await new TaskTopicModel(serverDB, userId).reopenSettledRun(topicId, 'op-answer')).toBe(
      true,
    );
    expect((await readRun()).status).toBe('running');
  });

  it('leaves the end stamp to the caller', async () => {
    // The row and the topic's `completedAt` are two aggregates; the caller
    // commits them together, so a lone reopen must not half-apply the pair.
    await seed();

    await new TaskTopicModel(serverDB, userId).reopenSettledRun(topicId, 'op-answer');

    expect((await readTopic()).completedAt).toBeInstanceOf(Date);
  });

  it('does not touch a run owned by someone else', async () => {
    await seed();

    expect(
      await new TaskTopicModel(serverDB, 'someone-else').reopenSettledRun(topicId, 'op-x'),
    ).toBe(false);
    expect(await readRun()).toMatchObject({ operationId: 'op-original', status: 'completed' });
  });
});
