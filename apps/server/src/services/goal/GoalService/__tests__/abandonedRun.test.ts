// @vitest-environment node
import type { ChatTopicMetadata } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import {
  agentOperations,
  goalEdges,
  goalEvents,
  goalNodeDecisions,
  goalNodes,
  goals,
  tasks,
  taskTopics,
  topics,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime/AgentRuntimeCoordinator';
import { AiAgentService } from '@/server/services/aiAgent';

import { deviceGateway } from '../../../deviceGateway';
import { TaskRunnerService } from '../../../taskRunner';
import { VERIFY_SETTLE_GRACE_MS } from '../../recoveryPolicy';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-verify-repair-test-user';

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId }).onConflictDoNothing();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(goalNodeDecisions);
  await serverDB.delete(goalEdges);
  await serverDB.delete(goalEvents);
  await serverDB.delete(goalNodes);
  await serverDB.delete(goals);
  await serverDB.delete(agentOperations);
  await serverDB.delete(taskTopics);
  await serverDB.delete(topics);
  await serverDB.delete(tasks);
  await serverDB.delete(users);
});

/**
 * A Task delivered over an hour ago whose verify run failed a check and sent
 * an auto-repair operation back into the delivered topic. The topic row stays
 * `completed` the whole time, so the coordinator sees no running topic.
 */
const seedRepairedDelivery = async (title: string) => {
  const service = new GoalService(serverDB, userId);
  const taskModel = new TaskModel(serverDB, userId);
  const graph = await service.create({
    config: { recovery: { operationLeaseTimeoutMs: 60_000 } },
    tasks: [title],
    title,
  });
  const created = await service.tick(graph.goal.id);
  const deliveredAt = new Date(Date.now() - VERIFY_SETTLE_GRACE_MS - 5 * 60_000);
  await serverDB.insert(topics).values({ id: 'tpc_delivered', userId });
  await serverDB.insert(taskTopics).values({
    completedAt: deliveredAt,
    createdAt: deliveredAt,
    operationId: 'op-delivered',
    seq: 1,
    status: 'completed',
    taskId: created.taskId!,
    topicId: 'tpc_delivered',
    userId,
  });
  await taskModel.updateStatus(created.taskId!, 'running');
  await serverDB
    .update(tasks)
    .set({ updatedAt: new Date(Date.now() - 10 * 60_000) })
    .where(eq(tasks.id, created.taskId!));
  await new AgentOperationModel(serverDB, userId).recordStart({
    operationId: 'op-repair',
    startedAt: new Date(Date.now() - 55 * 60_000),
    topicId: 'tpc_delivered',
  });
  return { goalId: graph.goal.id, service, taskId: created.taskId!, taskModel };
};

describe('GoalService verify repair in a delivered topic', () => {
  it('does not re-dispatch while the repair run in the delivered topic is alive', async () => {
    // The repair runs inside the completed topic, so the coordinator found no
    // running topic, measured the grace window from the original delivery, and
    // dispatched a second attempt beside the live repair — two agents pushing
    // the same branch, and the retry's round shadowing the repair's.
    const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const { goalId, service, taskId, taskModel } = await seedRepairedDelivery('Repair is alive');

    const waiting = await service.tick(goalId);

    expect(waiting).toMatchObject({ outcome: 'waiting_external', taskId });
    expect((await taskModel.findById(taskId))?.status).toBe('running');
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('gives the verdict on a finished repair its own grace window', async () => {
    const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const { goalId, service, taskId, taskModel } = await seedRepairedDelivery('Repair finished');
    await serverDB
      .update(agentOperations)
      .set({ completedAt: new Date(Date.now() - 5 * 60_000), status: 'done' })
      .where(eq(agentOperations.id, 'op-repair'));

    const waiting = await service.tick(goalId);

    expect(waiting).toMatchObject({ outcome: 'waiting_external', taskId });
    expect((await taskModel.findById(taskId))?.status).toBe('running');
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('still reclaims the Task once a dead repair has been silent past the grace window', async () => {
    const { goalId, service, taskId, taskModel } = await seedRepairedDelivery('Repair died');
    await serverDB
      .update(agentOperations)
      .set({ updatedAt: new Date(Date.now() - VERIFY_SETTLE_GRACE_MS - 60_000) })
      .where(eq(agentOperations.id, 'op-repair'));

    const released = await service.tick(goalId);

    expect(released.outcome).toBe('advanced');
    expect((await taskModel.findById(taskId))?.status).toBe('backlog');
  });
  it('holds while the repair is parked, however long it has been quiet', async () => {
    // A repair waiting for a person or a client stops heartbeating on purpose
    // and can still resume; its old heartbeat must not read as a dead repair.
    const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const { goalId, service, taskId, taskModel } = await seedRepairedDelivery('Repair parked');
    await serverDB
      .update(agentOperations)
      .set({
        status: 'waiting_for_human',
        updatedAt: new Date(Date.now() - VERIFY_SETTLE_GRACE_MS - 60_000),
      })
      .where(eq(agentOperations.id, 'op-repair'));

    const waiting = await service.tick(goalId);

    expect(waiting).toMatchObject({ outcome: 'waiting_external', taskId });
    expect((await taskModel.findById(taskId))?.status).toBe('running');
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('finds a live repair root behind more than five newer child runs', async () => {
    const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const { goalId, service, taskId } = await seedRepairedDelivery('Repair with children');
    const longAgo = new Date(Date.now() - 3 * VERIFY_SETTLE_GRACE_MS);
    await serverDB
      .update(agentOperations)
      .set({ createdAt: longAgo })
      .where(eq(agentOperations.id, 'op-repair'));
    const operationModel = new AgentOperationModel(serverDB, userId);
    for (let i = 0; i < 6; i++) {
      const operationId = `op-repair-child-${i}`;
      await operationModel.recordStart({
        operationId,
        parentOperationId: 'op-repair',
        topicId: 'tpc_delivered',
      });
      await serverDB
        .update(agentOperations)
        .set({
          completedAt: new Date(longAgo.getTime() + 60_000),
          createdAt: new Date(longAgo.getTime() + (i + 1) * 1000),
          status: 'done',
        })
        .where(eq(agentOperations.id, operationId));
    }

    const waiting = await service.tick(goalId);

    expect(waiting).toMatchObject({ outcome: 'waiting_external', taskId });
    expect(runSpy).not.toHaveBeenCalled();
  });
});

describe('GoalService lease reclaim of a running topic', () => {
  const seedStaleRun = async (title: string, metadata?: ChatTopicMetadata) => {
    const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({
      operationId: 'op-next',
      success: true,
    } as never);
    // A `task_topics` row carries no topic metadata; the device lives on the topic.
    await serverDB.insert(topics).values({ id: 'tpc_stuck', metadata, userId });
    const stuckTopic = { operationId: 'op-stuck', topicId: 'tpc_stuck' } as never;
    vi.spyOn(TaskTopicModel.prototype, 'findRunningByTaskIds').mockResolvedValue([stuckTopic]);
    vi.spyOn(TaskTopicModel.prototype, 'findWithHandoff').mockResolvedValue([
      { ...(stuckTopic as object), status: 'timeout' } as never,
    ]);
    vi.spyOn(TaskTopicModel.prototype, 'updateStatus').mockResolvedValue(undefined);
    vi.spyOn(AgentRuntimeCoordinator.prototype, 'getOperationMetadata').mockResolvedValue(
      undefined as never,
    );
    // The runtime still holds the stuck step: something is executing the run.
    vi.spyOn(AgentRuntimeCoordinator.prototype, 'loadAgentState').mockResolvedValue({
      status: 'running',
    } as never);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { maxAttemptsPerTask: 3, operationLeaseTimeoutMs: 60_000 } },
      tasks: [title],
      title,
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.update(created.taskId!, { totalTopics: 1 });
    await taskModel.updateStatus(created.taskId!, 'running');
    await new AgentOperationModel(serverDB, userId).recordStart({
      operationId: 'op-stuck',
      taskId: created.taskId,
      topicId: null,
    });
    await serverDB
      .update(agentOperations)
      .set({ updatedAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(agentOperations.id, 'op-stuck'));
    return { goalId: graph.goal.id, runSpy, service, taskId: created.taskId!, taskModel };
  };

  it('stops the stale run before reclaiming it', async () => {
    // A run stuck on a tool call stops heartbeating, so its lease expires and
    // the next attempt starts. Settling only the row left the stuck run alive:
    // when its tool call returned it kept working beside its replacement.
    const interruptSpy = vi
      .spyOn(AiAgentService.prototype, 'interruptTask')
      .mockResolvedValue({ success: true });
    const { goalId, service } = await seedStaleRun('Stuck on a tool call');

    await service.tick(goalId);

    expect(interruptSpy).toHaveBeenCalledWith({ operationId: 'op-stuck', topicId: 'tpc_stuck' });
    expect(await new AgentOperationModel(serverDB, userId).findById('op-stuck')).toMatchObject({
      status: 'abandoned',
    });
  });

  it.each([
    ['refused', () => Promise.resolve({ success: false })],
    [
      'device exit unconfirmed',
      () => Promise.resolve({ deviceCancellationConfirmed: false, success: true }),
    ],
    ['unreachable', () => Promise.reject(new Error('gateway down'))],
  ])('starts no replacement while the stale run may still be writing (%s)', async (_, outcome) => {
    // `interruptTask` reports an unconfirmed stop as a resolved result. Reading
    // only a throw as failure dispatched the replacement beside a live writer.
    vi.spyOn(AiAgentService.prototype, 'interruptTask').mockImplementation(outcome as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { goalId, runSpy, service, taskId, taskModel } = await seedStaleRun('Still writing');

    await service.tick(goalId);

    expect(runSpy).not.toHaveBeenCalled();
    expect((await taskModel.findById(taskId))?.status).toBe('running');
    expect(TaskTopicModel.prototype.updateStatus).not.toHaveBeenCalled();
  });

  it('retries the stop on the next tick and reclaims once it is confirmed', async () => {
    const interruptSpy = vi
      .spyOn(AiAgentService.prototype, 'interruptTask')
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true });
    const { goalId, service } = await seedStaleRun('Stop confirmed later');

    await service.tick(goalId);
    expect(TaskTopicModel.prototype.updateStatus).not.toHaveBeenCalled();

    await service.tick(goalId);

    expect(interruptSpy).toHaveBeenCalledTimes(2);
    expect(TaskTopicModel.prototype.updateStatus).toHaveBeenCalledWith(
      expect.any(String),
      'tpc_stuck',
      'timeout',
    );
  });

  it('leaves a run alone when it heartbeats between the staleness read and the claim', async () => {
    // Interrupting on a stale read alone cancelled a run whose heartbeat landed
    // a moment later; the claim's compare-and-set must decide, before the stop.
    const interruptSpy = vi.spyOn(AiAgentService.prototype, 'interruptTask');
    const { goalId, runSpy, service } = await seedStaleRun('Heartbeat wins');
    vi.spyOn(AgentRuntimeCoordinator.prototype, 'loadAgentState').mockImplementation(async () => {
      await new AgentOperationModel(serverDB, userId).touchRunning('op-stuck');
      return { status: 'running' } as never;
    });

    await service.tick(goalId);

    expect(interruptSpy).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
    expect(TaskTopicModel.prototype.updateStatus).not.toHaveBeenCalled();
    expect(await new AgentOperationModel(serverDB, userId).findById('op-stuck')).toMatchObject({
      status: 'running',
    });
  });

  it('still reclaims a run whose device is offline', async () => {
    // An offline device can never confirm the stop; holding for it would strand
    // the goal. The reclaim proceeds and the offline-device recovery takes over.
    vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
    vi.spyOn(deviceGateway, 'queryDeviceList').mockResolvedValue([]);
    vi.spyOn(AiAgentService.prototype, 'interruptTask').mockResolvedValue({ success: false });
    // As in production: only the topic's running marker knows the device.
    const { goalId, service } = await seedStaleRun('Device asleep', {
      runningOperation: {
        assistantMessageId: 'msg-stuck',
        deviceId: 'device-laptop',
        operationId: 'op-stuck',
      },
    });

    await service.tick(goalId);

    expect(TaskTopicModel.prototype.updateStatus).toHaveBeenCalledWith(
      expect.any(String),
      'tpc_stuck',
      'timeout',
    );
    expect(await new AgentOperationModel(serverDB, userId).findById('op-stuck')).toMatchObject({
      status: 'abandoned',
    });
  });
});
