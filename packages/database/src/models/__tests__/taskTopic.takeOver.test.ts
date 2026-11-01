// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, tasks, taskTopics, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskTopicModel } from '../taskTopic';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-topic-takeover-test-user-id';
const taskId = 'task-takeover-1';
const topicId = 'tpc-takeover-1';

const readRun = async () =>
  (await serverDB.select().from(taskTopics).where(eq(taskTopics.topicId, topicId)).limit(1))[0];

const model = () => new TaskTopicModel(serverDB, userId);

const seedOperation = (id: string, createdAt: Date) =>
  serverDB.insert(agentOperations).values({ createdAt, id, status: 'running', topicId, userId });

/** A Task whose run is still `running` under `op-old`. */
const seed = async ({ runStatus = 'running', operationId = 'op-old' } = {}) => {
  await serverDB.insert(tasks).values({
    createdByUserId: userId,
    id: taskId,
    identifier: 'T-1',
    instruction: 'do the thing',
    seq: 1,
    status: 'running',
  });
  await serverDB.insert(topics).values({ id: topicId, userId });
  await serverDB.insert(taskTopics).values({
    operationId,
    seq: 1,
    status: runStatus,
    taskId,
    topicId,
    trigger: 'schedule',
    userId,
  });
};

beforeEach(async () => {
  await serverDB.delete(agentOperations);
  await serverDB.delete(taskTopics);
  await serverDB.delete(topics);
  await serverDB.delete(tasks);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
});

afterEach(async () => {
  await serverDB.delete(agentOperations);
  await serverDB.delete(taskTopics);
  await serverDB.delete(users);
});

describe('TaskTopicModel.takeOverRunningRun', () => {
  it('hands a running run to the operation that replaced it', async () => {
    await seed();

    await expect(model().takeOverRunningRun(topicId, 'op-old', 'op-new')).resolves.toBe(true);

    const run = await readRun();
    expect(run.operationId).toBe('op-new');
    expect(run.status).toBe('running');
    // A user's follow-up is not an automation tick.
    expect(run.trigger).toBe('manual');
  });

  it('leaves a row another operation already owns', async () => {
    await seed({ operationId: 'op-other' });

    await expect(model().takeOverRunningRun(topicId, 'op-old', 'op-new')).resolves.toBe(false);
    expect((await readRun()).operationId).toBe('op-other');
  });

  it('leaves a run that settled in the meantime', async () => {
    await seed({ runStatus: 'completed' });

    await expect(model().takeOverRunningRun(topicId, 'op-old', 'op-new')).resolves.toBe(false);
    const run = await readRun();
    expect(run.operationId).toBe('op-old');
    expect(run.status).toBe('completed');
  });
});

describe('TaskTopicModel.isSupersededOperation', () => {
  it('is true for an older operation once a newer one owns the row', async () => {
    await seed({ operationId: 'op-new' });
    await seedOperation('op-old', new Date('2026-11-01T10:38:03Z'));
    await seedOperation('op-new', new Date('2026-11-01T10:38:48Z'));

    await expect(model().isSupersededOperation(topicId, 'op-old')).resolves.toBe(true);
    await expect(model().isSupersededOperation(topicId, 'op-new')).resolves.toBe(false);
  });

  it('is false for a newer operation the row does not name yet', async () => {
    // The runner records a continued run only after its dispatch returns, so a
    // short run can report while the row still names the previous one.
    await seed({ operationId: 'op-old', runStatus: 'completed' });
    await seedOperation('op-old', new Date('2026-11-01T10:38:03Z'));
    await seedOperation('op-new', new Date('2026-11-01T10:38:48Z'));

    await expect(model().isSupersededOperation(topicId, 'op-new')).resolves.toBe(false);
  });

  it('is false when either operation is unknown', async () => {
    await seed({ operationId: 'op-new' });
    await seedOperation('op-new', new Date('2026-11-01T10:38:48Z'));

    await expect(model().isSupersededOperation(topicId, 'op-missing')).resolves.toBe(false);
  });
});

describe('TaskTopicModel.updateStatus guarded by the reporting operation', () => {
  it('refuses the write of an operation a newer one took the row over from', async () => {
    await seed({ operationId: 'op-new' });
    await seedOperation('op-old', new Date('2026-11-01T10:38:03Z'));
    await seedOperation('op-new', new Date('2026-11-01T10:38:48Z'));

    await expect(
      model().updateStatus(taskId, topicId, 'completed', { reportedOperationId: 'op-old' }),
    ).resolves.toBe(false);
    expect((await readRun()).status).toBe('running');
  });

  it('writes for the operation the row names, and for a newer one it does not name yet', async () => {
    await seed({ operationId: 'op-old' });
    await seedOperation('op-old', new Date('2026-11-01T10:38:03Z'));
    await seedOperation('op-new', new Date('2026-11-01T10:38:48Z'));

    await expect(
      model().updateStatus(taskId, topicId, 'failed', { reportedOperationId: 'op-old' }),
    ).resolves.toBe(true);
    expect((await readRun()).status).toBe('failed');

    // The runner records a continued run only after its dispatch returns.
    await expect(
      model().updateStatus(taskId, topicId, 'completed', { reportedOperationId: 'op-new' }),
    ).resolves.toBe(true);
    expect((await readRun()).status).toBe('completed');
  });
});
