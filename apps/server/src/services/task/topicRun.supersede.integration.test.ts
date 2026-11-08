// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { agentOperations, tasks, taskTopics, topics, users } from '@/database/schemas';
import { TaskLifecycleService } from '@/server/services/taskLifecycle';
import { ORPHANED_RUN_GRACE_MS } from '@/server/services/taskLifecycle/reconcile';
import { reconcileInterruptedTaskRuns } from '@/server/services/taskLifecycle/reconcileInterrupted';

import { TopicRunService } from './topicRun';

/**
 * The incident: a Task run finished its last reply, the user followed up a few
 * seconds later, and the follow-up superseded the run before it had settled. The
 * superseded run ended `interrupted`, which never settles the run row, and the
 * follow-up did not take the row over because it was still `running` — so the
 * Task stayed `running` with nothing behind it, for every later follow-up too.
 */
const userId = 'topic-run-supersede-integration-user';

// Module-level, like the database model tests: the first call migrates a
// fresh database, which can outlast a hook timeout on a loaded CI shard.
const db: LobeChatDatabase = await getTestDB();

const T0 = new Date('2026-11-01T10:38:03Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

let seq = 0;

const seedOperation = async (
  topicId: string,
  id: string,
  values: { createdAt: Date; status: string; trigger?: string },
) => {
  await db.insert(agentOperations).values({
    completedAt: values.status === 'running' ? null : values.createdAt,
    createdAt: values.createdAt,
    id,
    status: values.status as any,
    topicId,
    trigger: values.trigger,
    updatedAt: values.createdAt,
    userId,
  });
};

/** A root Task whose run is `running` under `op-task` on its own topic. */
const seedRunningTask = async (
  operation: { status: string; trigger?: string } = { status: 'running', trigger: 'task' },
) => {
  seq += 1;
  const task = await new TaskModel(db, userId).create({ instruction: 'Write the report' });
  await db.update(tasks).set({ startedAt: T0, status: 'running' }).where(eq(tasks.id, task.id));

  const topicId = `tpc-supersede-${seq}`;
  const taskOperationId = `op-task-${seq}`;
  await db.insert(topics).values({ id: topicId, userId });
  await seedOperation(topicId, taskOperationId, { createdAt: T0, ...operation });
  await db.insert(taskTopics).values({
    operationId: taskOperationId,
    seq: 1,
    status: 'running',
    taskId: task.id,
    topicId,
    trigger: 'manual',
    userId,
  });

  return { task, taskOperationId, topicId };
};

const readRun = async (topicId: string) =>
  (await db.select().from(taskTopics).where(eq(taskTopics.topicId, topicId)).limit(1))[0];

const readTask = async (taskId: string) => new TaskModel(db, userId).findById(taskId);

const complete = (
  task: { id: string; identifier: string },
  topicId: string,
  operationId: string,
  reason = 'done',
) =>
  new TaskLifecycleService(db, userId).onTopicComplete({
    operationId,
    reason,
    taskId: task.id,
    taskIdentifier: task.identifier,
    topicId,
  });

beforeEach(async () => {
  await db.delete(agentOperations).where(eq(agentOperations.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
});

afterEach(async () => {
  await db.delete(agentOperations).where(eq(agentOperations.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

describe('a follow-up that supersedes a live Task run (real PostgreSQL)', () => {
  it('takes the run over, and the Task goes to review when the follow-up ends', async () => {
    const { task, taskOperationId, topicId } = await seedRunningTask();
    const service = new TopicRunService(db, userId);

    // The composer names the live run it replaces.
    const link = await service.resolveOwnableRun(topicId, {
      replacesOperationId: taskOperationId,
      supersedeLiveRun: true,
    });
    expect(link).toMatchObject({ takeOverOperationId: taskOperationId, taskId: task.id });

    // The start interrupts the replaced run, then creates the follow-up.
    await db
      .update(agentOperations)
      .set({ completedAt: at(45), status: 'interrupted' })
      .where(eq(agentOperations.id, taskOperationId));
    await seedOperation(topicId, 'op-follow-up', { createdAt: at(45), status: 'running' });

    await expect(service.reopen({ link: link!, operationId: 'op-follow-up' })).resolves.toBe(
      'reopened',
    );
    expect(await readRun(topicId)).toMatchObject({
      operationId: 'op-follow-up',
      status: 'running',
    });

    // The follow-up is the run that ends the Task's turn.
    await complete(task, topicId, 'op-follow-up');

    expect((await readRun(topicId)).status).toBe('completed');
    expect((await readTask(task.id))?.status).toBe('paused');
  });

  it('takes over from a run a queued follow-up already stopped, before it reads interrupted', async () => {
    // A queued follow-up sent "now" interrupts the run and clears the topic
    // marker before it starts, and names no `replacesOperationId`: the run row
    // and the operation still read `running`, only its interrupt is set.
    const { task, taskOperationId, topicId } = await seedRunningTask();
    const service = new TopicRunService(db, userId);
    const isStopRequested = async (operationId: string) => operationId === taskOperationId;

    const link = await service.resolveOwnableRun(topicId, {
      isStopRequested,
      supersedeLiveRun: true,
    });
    expect(link?.takeOverOperationId).toBe(taskOperationId);

    await seedOperation(topicId, 'op-send-now', { createdAt: at(14), status: 'running' });
    await expect(service.reopen({ link: link!, operationId: 'op-send-now' })).resolves.toBe(
      'reopened',
    );
    await complete(task, topicId, 'op-send-now');

    expect((await readRun(topicId)).status).toBe('completed');
    expect((await readTask(task.id))?.status).toBe('paused');
  });

  it('leaves a live run nobody asked to stop, and fails closed on an unreadable interrupt state', async () => {
    const { topicId } = await seedRunningTask();
    const service = new TopicRunService(db, userId);

    await expect(
      service.resolveOwnableRun(topicId, { isStopRequested: async () => false }),
    ).resolves.toBeUndefined();
    await expect(
      service.resolveOwnableRun(topicId, {
        isStopRequested: async () => {
          throw new Error('redis down');
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('takes over from a run that already ended but never settled the row', async () => {
    // Every later follow-up of the stuck topic: the run row still names the
    // interrupted run, and no client tracks it any more.
    const { task, taskOperationId, topicId } = await seedRunningTask({
      status: 'interrupted',
      trigger: 'task',
    });
    const service = new TopicRunService(db, userId);

    const link = await service.resolveOwnableRun(topicId, { supersedeLiveRun: true });
    expect(link?.takeOverOperationId).toBe(taskOperationId);

    await seedOperation(topicId, 'op-later', { createdAt: at(120), status: 'running' });
    await expect(service.reopen({ link: link!, operationId: 'op-later' })).resolves.toBe(
      'reopened',
    );
    await complete(task, topicId, 'op-later');

    expect((await readTask(task.id))?.status).toBe('paused');
  });

  it('takes over from the live foreground run the composer retires', async () => {
    const { taskOperationId, topicId } = await seedRunningTask({
      status: 'running',
      trigger: 'chat',
    });
    await db
      .update(topics)
      .set({
        metadata: {
          runningOperation: { assistantMessageId: 'msg-1', operationId: taskOperationId },
        },
      })
      .where(eq(topics.id, topicId));

    const link = await new TopicRunService(db, userId).resolveOwnableRun(topicId, {
      supersedeLiveRun: true,
    });

    expect(link?.takeOverOperationId).toBe(taskOperationId);
  });

  it('leaves a live run that this send does not stop', async () => {
    // A Task-triggered run is a background producer's: the composer does not
    // retire it unless the client names it, so the follow-up is a plain turn.
    const { taskOperationId, topicId } = await seedRunningTask();
    const service = new TopicRunService(db, userId);

    await expect(
      service.resolveOwnableRun(topicId, { supersedeLiveRun: true }),
    ).resolves.toBeUndefined();
    // A server-started follow-up never retires the run it waits on.
    await expect(
      service.resolveOwnableRun(topicId, { supersedeLiveRun: false }),
    ).resolves.toBeUndefined();
    expect((await readRun(topicId)).operationId).toBe(taskOperationId);
  });

  it('never hands the run to a thread send, which stops nothing on the main spine', async () => {
    const { taskOperationId, topicId } = await seedRunningTask();

    await expect(
      new TopicRunService(db, userId).resolveOwnableRun(topicId, {
        replacesOperationId: taskOperationId,
        supersedeLiveRun: true,
        threadId: 'thd-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('leaves a run whose operation wrote no row', async () => {
    // A run executed on the client never writes one; that proves nothing.
    const { taskOperationId, topicId } = await seedRunningTask();
    await db.delete(agentOperations).where(eq(agentOperations.id, taskOperationId));

    await expect(
      new TopicRunService(db, userId).resolveOwnableRun(topicId, { supersedeLiveRun: true }),
    ).resolves.toBeUndefined();
  });

  it('ignores the superseded run when it reports after the follow-up took over', async () => {
    const { task, taskOperationId, topicId } = await seedRunningTask();
    const service = new TopicRunService(db, userId);
    const link = await service.resolveOwnableRun(topicId, {
      replacesOperationId: taskOperationId,
    });
    await seedOperation(topicId, 'op-follow-up', { createdAt: at(45), status: 'running' });
    await service.reopen({ link: link!, operationId: 'op-follow-up' });

    // The old run's success and an error from tearing it down both arrive late.
    await complete(task, topicId, taskOperationId, 'done');
    await complete(task, topicId, taskOperationId, 'error');

    expect(await readRun(topicId)).toMatchObject({
      operationId: 'op-follow-up',
      status: 'running',
    });
    const stored = await readTask(task.id);
    expect(stored?.status).toBe('running');
    expect(stored?.error).toBeNull();
  });
});

describe('a superseded run that completes while the follow-up takes over (real PostgreSQL)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loses the run row to the follow-up even when it passed the ownership check first', async () => {
    const { task, taskOperationId, topicId } = await seedRunningTask();
    const service = new TopicRunService(db, userId);
    await seedOperation(topicId, 'op-follow-up', { createdAt: at(45), status: 'running' });

    // The old run's completion checks ownership while it still owns the row…
    const realCheck = TaskTopicModel.prototype.isSupersededOperation;
    vi.spyOn(TaskTopicModel.prototype, 'isSupersededOperation').mockImplementationOnce(
      async function (this: TaskTopicModel, ...args) {
        const superseded = await realCheck.apply(this, args);
        // …and the follow-up takes the row over right after that check.
        const link = await service.resolveOwnableRun(topicId, {
          replacesOperationId: taskOperationId,
        });
        await service.reopen({ link: link!, operationId: 'op-follow-up' });
        return superseded;
      },
    );

    await complete(task, topicId, taskOperationId, 'done');

    // The follow-up's live run keeps the row, and the Task keeps running.
    expect(await readRun(topicId)).toMatchObject({
      operationId: 'op-follow-up',
      status: 'running',
    });
    expect((await readTask(task.id))?.status).toBe('running');
  });
});

describe('a follow-up that reopens the run while its last completion is still settling (real PostgreSQL)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('leaves the Task to the follow-up instead of pausing it under the live run', async () => {
    const { task, taskOperationId, topicId } = await seedRunningTask();
    const service = new TopicRunService(db, userId);
    // Resolved while the old run still owns a `running` row.
    const link = await service.resolveOwnableRun(topicId, {
      replacesOperationId: taskOperationId,
    });
    await seedOperation(topicId, 'op-follow-up', { createdAt: at(45), status: 'running' });

    // The old run settles the row first; the follow-up's takeover then misses
    // and reopens the settled row, while the old completion is still running.
    const realUpdate = TaskTopicModel.prototype.updateStatus;
    vi.spyOn(TaskTopicModel.prototype, 'updateStatus').mockImplementationOnce(async function (
      this: TaskTopicModel,
      ...args
    ) {
      const written = await realUpdate.apply(this, args);
      await expect(service.reopen({ link: link!, operationId: 'op-follow-up' })).resolves.toBe(
        'reopened',
      );
      return written;
    });

    await complete(task, topicId, taskOperationId, 'done');

    expect(await readRun(topicId)).toMatchObject({
      operationId: 'op-follow-up',
      status: 'running',
    });
    expect((await readTask(task.id))?.status).toBe('running');

    // The follow-up is the run that settles the Task.
    await complete(task, topicId, 'op-follow-up');
    expect((await readTask(task.id))?.status).toBe('paused');
  });
});

describe('reconcileInterruptedTaskRuns (real PostgreSQL)', () => {
  const staleBefore = new Date(T0.getTime() + ORPHANED_RUN_GRACE_MS);

  it('parks a Task whose interrupted run nothing took over', async () => {
    const { task, topicId } = await seedRunningTask({ status: 'interrupted', trigger: 'task' });

    const result = await reconcileInterruptedTaskRuns(db, { staleBefore });

    expect(result.paused).toContain(topicId);
    expect((await readRun(topicId)).status).toBe('canceled');
    const stored = await readTask(task.id);
    // Back to a person — not a verdict on the work.
    expect(stored?.status).toBe('paused');
    expect(stored?.completedAt).toBeNull();
  });

  it('leaves a Task whose conversation still has a run going', async () => {
    const { task, topicId } = await seedRunningTask({ status: 'interrupted', trigger: 'task' });
    await seedOperation(topicId, 'op-still-going', { createdAt: at(45), status: 'running' });

    const result = await reconcileInterruptedTaskRuns(db, { staleBefore });

    expect(result.paused).not.toContain(topicId);
    expect((await readRun(topicId)).status).toBe('running');
    expect((await readTask(task.id))?.status).toBe('running');
  });

  it('waits out the grace window', async () => {
    const { task, topicId } = await seedRunningTask({ status: 'interrupted', trigger: 'task' });

    const result = await reconcileInterruptedTaskRuns(db, { staleBefore: T0 });

    expect(result.paused).not.toContain(topicId);
    expect((await readTask(task.id))?.status).toBe('running');
  });
});
