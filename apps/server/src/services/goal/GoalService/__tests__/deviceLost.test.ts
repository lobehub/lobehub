// @vitest-environment node
import { DEVICE_OFFLINE_RUN_STATUS } from '@lobechat/const/goal';
import type { ChatTopicMetadata } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { agentOperations, taskTopics, topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { deviceGateway } from '../../../deviceGateway';
import { TaskRunnerService } from '../../../taskRunner';
import { VERIFICATION_FAILED_ERROR } from '../../decideNextMove';
import { DEVICE_OFFLINE_GATE_REASON } from '../../recoveryPolicy';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

describe('GoalService', () => {
  describe('a Task whose runs its device lost', () => {
    const MINUTE = 60 * 1000;
    const HOUR = 60 * MINUTE;

    const setup = async (title: string, maxAttemptsPerTask: number) => {
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
      vi.spyOn(deviceGateway, 'queryDeviceList').mockResolvedValue([]);
      const runSpy = vi
        .spyOn(TaskRunnerService.prototype, 'runTask')
        .mockResolvedValue({ operationId: 'op-retry', success: true } as never);
      const service = new GoalService(serverDB, userId);
      const taskModel = new TaskModel(serverDB, userId);
      const graph = await service.create({
        config: { recovery: { maxAttemptsPerTask, operationLeaseTimeoutMs: 60_000 } },
        title,
        tasks: ['Run on the laptop'],
      });
      const created = await service.tick(graph.goal.id);
      runSpy.mockClear();
      return { created, graph, runSpy, service, taskModel };
    };

    const addRun = async (
      taskId: string,
      seq: number,
      status: string,
      options: { metadata?: ChatTopicMetadata; operationId?: string; updatedAt?: Date } = {},
    ) => {
      const topicId = `tpc_offline_${seq}`;
      await serverDB.insert(topics).values({ id: topicId, metadata: options.metadata, userId });
      await serverDB.insert(taskTopics).values({
        operationId: options.operationId,
        seq,
        status,
        taskId,
        topicId,
        userId,
        ...(options.updatedAt && { updatedAt: options.updatedAt }),
      });
      return topicId;
    };

    /** `count` consecutive offline runs, the newest `sinceLast` ago. */
    const addOfflineRuns = async (taskId: string, count: number, sinceLast: number) => {
      for (let seq = 1; seq <= count; seq++) {
        await addRun(taskId, seq, DEVICE_OFFLINE_RUN_STATUS, {
          updatedAt: new Date(Date.now() - sinceLast - (count - seq) * HOUR),
        });
      }
    };

    const decisionReasons = async (service: GoalService, goalId: string) =>
      (await service.graph(goalId)).nodes
        .filter((node) => node.kind === 'decision')
        .map((node) => node.description);

    it('does not charge a run lost while its device was offline to the attempt budget', async () => {
      const { created, graph, runSpy, service, taskModel } = await setup(
        'Laptop went offline mid-run',
        1,
      );
      await taskModel.update(created.taskId!, { totalTopics: 1 });
      await taskModel.updateStatus(created.taskId!, 'running');
      const operationModel = new AgentOperationModel(serverDB, userId);
      await operationModel.recordStart({ operationId: 'op-lost', taskId: created.taskId });
      await serverDB
        .update(agentOperations)
        .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
        .where(eq(agentOperations.id, 'op-lost'));
      const topicId = await addRun(created.taskId!, 1, 'running', {
        metadata: {
          runningOperation: {
            assistantMessageId: 'msg-lost',
            deviceId: 'device-laptop',
            operationId: 'op-lost',
          },
        },
        operationId: 'op-lost',
      });

      const waiting = await service.tick(graph.goal.id);

      expect(waiting).toMatchObject({
        message: expect.stringContaining('waiting for its device to reconnect'),
        outcome: 'waiting_external',
        taskId: created.taskId,
      });
      expect(runSpy).not.toHaveBeenCalled();
      expect(await decisionReasons(service, graph.goal.id)).toHaveLength(0);
      const [lost] = await new TaskTopicModel(serverDB, userId).findByTaskId(created.taskId!);
      expect(lost.status).toBe(DEVICE_OFFLINE_RUN_STATUS);

      // Once the first backoff has passed, the retry goes out on the budget the
      // lost run did not spend.
      await serverDB
        .update(taskTopics)
        .set({ updatedAt: new Date(Date.now() - 31 * MINUTE) })
        .where(eq(taskTopics.topicId, topicId));
      await service.tick(graph.goal.id);

      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: created.taskId, trigger: 'goal' }),
      );
      expect(await decisionReasons(service, graph.goal.id)).toHaveLength(0);
    });

    it('still charges a lost run whose device is online when it is reclaimed', async () => {
      const { created, graph, runSpy, service, taskModel } = await setup(
        'Run died on a connected laptop',
        1,
      );
      vi.spyOn(deviceGateway, 'queryDeviceList').mockResolvedValue([
        { deviceId: 'device-laptop' } as never,
      ]);
      await taskModel.update(created.taskId!, { totalTopics: 1 });
      await taskModel.updateStatus(created.taskId!, 'running');
      const operationModel = new AgentOperationModel(serverDB, userId);
      await operationModel.recordStart({ operationId: 'op-died', taskId: created.taskId });
      await serverDB
        .update(agentOperations)
        .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
        .where(eq(agentOperations.id, 'op-died'));
      await addRun(created.taskId!, 1, 'running', {
        metadata: { boundDeviceId: 'device-laptop' },
        operationId: 'op-died',
      });

      const gated = await service.tick(graph.goal.id);

      expect(gated).toMatchObject({ outcome: 'waiting_human', taskId: created.taskId });
      expect(runSpy).not.toHaveBeenCalled();
    });

    it.each([
      { before: 29 * MINUTE, after: 31 * MINUTE, offlineRuns: 1, schedule: '30min' },
      { before: 59 * MINUTE, after: 61 * MINUTE, offlineRuns: 2, schedule: '1h' },
      { before: 119 * MINUTE, after: 121 * MINUTE, offlineRuns: 3, schedule: '2h' },
      { before: 7 * HOUR + 59 * MINUTE, after: 8 * HOUR + MINUTE, offlineRuns: 5, schedule: '8h' },
      {
        before: 7 * HOUR + 59 * MINUTE,
        after: 8 * HOUR + MINUTE,
        offlineRuns: 6,
        schedule: '8h (capped)',
      },
    ])(
      'waits $schedule after offline run $offlineRuns before retrying',
      async ({ after, before, offlineRuns }) => {
        const { created, graph, runSpy, service, taskModel } = await setup(
          `Offline backoff ${offlineRuns}`,
          1,
        );
        await taskModel.update(created.taskId!, { totalTopics: offlineRuns });
        await addOfflineRuns(created.taskId!, offlineRuns, before);
        await taskModel.updateStatus(created.taskId!, 'paused', { error: 'DEVICE_OFFLINE' });

        const waiting = await service.tick(graph.goal.id);
        expect(waiting).toMatchObject({ outcome: 'waiting_external', taskId: created.taskId });
        expect(runSpy).not.toHaveBeenCalled();

        await serverDB
          .update(taskTopics)
          .set({ updatedAt: new Date(Date.now() - after) })
          .where(eq(taskTopics.topicId, `tpc_offline_${offlineRuns}`));
        await service.tick(graph.goal.id);

        expect(runSpy).toHaveBeenCalledWith(
          expect.objectContaining({ taskId: created.taskId, trigger: 'goal' }),
        );
        expect(await decisionReasons(service, graph.goal.id)).toHaveLength(0);
      },
    );

    it('retries at once when presence shows the device back before the backoff ends', async () => {
      const { created, graph, runSpy, service, taskModel } = await setup('Laptop woke up', 1);
      vi.spyOn(deviceGateway, 'queryDeviceList').mockResolvedValue([
        { deviceId: 'device-laptop' } as never,
      ]);
      await taskModel.update(created.taskId!, { totalTopics: 1 });
      await addRun(created.taskId!, 1, DEVICE_OFFLINE_RUN_STATUS, {
        metadata: { boundDeviceId: 'device-laptop' },
      });
      await taskModel.updateStatus(created.taskId!, 'paused', { error: 'DEVICE_OFFLINE' });

      await service.tick(graph.goal.id);

      expect(runSpy).toHaveBeenCalledOnce();
    });

    it('asks a person once every offline retry found the device gone', async () => {
      const { created, graph, runSpy, service, taskModel } = await setup(
        'Laptop never came back',
        1,
      );
      await taskModel.update(created.taskId!, { totalTopics: 7 });
      await addOfflineRuns(created.taskId!, 7, 10 * HOUR);
      await taskModel.updateStatus(created.taskId!, 'paused', { error: 'DEVICE_OFFLINE' });

      const gated = await service.tick(graph.goal.id);

      expect(gated).toMatchObject({ outcome: 'waiting_human', taskId: created.taskId });
      expect(runSpy).not.toHaveBeenCalled();
      expect(await decisionReasons(service, graph.goal.id)).toEqual([DEVICE_OFFLINE_GATE_REASON]);
    });

    it('keeps charging verification-rejected attempts to the budget', async () => {
      const { created, graph, runSpy, service, taskModel } = await setup(
        'Rejections still count',
        2,
      );
      await addRun(created.taskId!, 1, DEVICE_OFFLINE_RUN_STATUS);
      await addRun(created.taskId!, 2, 'completed');
      await taskModel.update(created.taskId!, { totalTopics: 2 });
      await taskModel.updateStatus(created.taskId!, 'paused', {
        error: VERIFICATION_FAILED_ERROR,
      });

      // One offline run and one rejection: only the rejection is charged.
      await service.tick(graph.goal.id);
      expect(runSpy).toHaveBeenCalledOnce();

      await addRun(created.taskId!, 3, 'completed');
      await taskModel.update(created.taskId!, { totalTopics: 3 });
      await taskModel.updateStatus(created.taskId!, 'paused', {
        error: VERIFICATION_FAILED_ERROR,
      });
      runSpy.mockClear();

      const gated = await service.tick(graph.goal.id);

      expect(gated).toMatchObject({ outcome: 'waiting_human', taskId: created.taskId });
      expect(runSpy).not.toHaveBeenCalled();
      expect(await decisionReasons(service, graph.goal.id)).toEqual([
        'Task attempt budget was exhausted',
      ]);
    });
  });
});
