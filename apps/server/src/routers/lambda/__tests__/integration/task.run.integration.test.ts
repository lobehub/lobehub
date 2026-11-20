// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskTopicModel } from '@/database/models/taskTopic';

import { taskRouter } from '../../task';
import {
  cleanupTestUser,
  createTestAgent,
  createTestContext,
  createTestTopic,
  createTestUser,
} from './setup';

const taskInput = (
  agentId: string,
): Parameters<ReturnType<typeof taskRouter.createCaller>['create']>[0] => ({
  assigneeAgentId: agentId,
  instruction: 'Test',
});

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

const mockExecAgent = vi.fn();
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return {
      execAgent: mockExecAgent,
      interruptTask: vi.fn().mockResolvedValue({ success: true }),
    };
  }),
}));

vi.mock('@/server/services/taskLifecycle', () => ({
  TaskLifecycleService: vi.fn().mockImplementation(function () {
    return { onTopicComplete: vi.fn() };
  }),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

describe('Task Router run', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let testAgentId: string;
  let testTopicId: string;
  let caller: ReturnType<typeof taskRouter.createCaller>;

  beforeEach(async () => {
    vi.clearAllMocks();
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    testAgentId = await createTestAgent(serverDB, userId, 'agt_test');
    testTopicId = await createTestTopic(serverDB, userId, 'tpc_test');
    mockExecAgent.mockResolvedValue({
      operationId: 'op_test',
      success: true,
      topicId: testTopicId,
    });
    caller = taskRouter.createCaller(createTestContext(userId));
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
  });

  describe('run idempotency', () => {
    it('resolves a task identifier to its row when starting a run', async () => {
      const task = await caller.create(taskInput(testAgentId));

      await caller.run({ id: task.data.identifier });

      const updated = await caller.detail({ id: task.data.id });
      expect(updated.data?.status).toBe('running');
    });

    it('should reject run when a topic is already running', async () => {
      const task = await caller.create(taskInput(testAgentId));

      // First run succeeds
      await caller.run({ id: task.data.id });

      // Second run should fail with CONFLICT
      await expect(caller.run({ id: task.data.id })).rejects.toThrow(/already has a running topic/);
    });

    it('should reject continue on already running topic', async () => {
      const task = await caller.create(taskInput(testAgentId));

      await caller.run({ id: task.data.id });

      await expect(caller.run({ continueTopicId: 'tpc_test', id: task.data.id })).rejects.toThrow(
        /already running/,
      );
    });

    describe('a running topic left behind by an ended operation', () => {
      const SIX_HOURS_AGO = () => new Date(Date.now() - 6 * 60 * 60 * 1000);

      /** A scheduled task at rest whose earlier run row still reads `running`. */
      const seedBlockedScheduledTask = async (operation: {
        completedAt?: Date | null;
        status: 'done' | 'running';
        updatedAt: Date;
      }) => {
        const { agentOperations, tasks } = await import('@/database/schemas');
        const { eq } = await import('drizzle-orm');
        const task = await caller.create(taskInput(testAgentId));
        const topicId = await createTestTopic(serverDB, userId);
        const operationId = `op_${topicId}`;
        await serverDB.insert(agentOperations).values({
          completedAt: operation.completedAt ?? null,
          id: operationId,
          status: operation.status,
          topicId,
          updatedAt: operation.updatedAt,
          userId,
        });
        await new TaskTopicModel(serverDB, userId).add(task.data.id, topicId, {
          operationId,
          seq: 1,
          trigger: 'schedule',
        });
        // Back at rest between ticks: no reconciliation sweep looks at this row.
        await serverDB.update(tasks).set({ status: 'scheduled' }).where(eq(tasks.id, task.data.id));
        return { operationId, taskId: task.data.id, topicId };
      };

      afterEach(async () => {
        const { agentOperations } = await import('@/database/schemas');
        const { eq } = await import('drizzle-orm');
        await serverDB.delete(agentOperations).where(eq(agentOperations.userId, userId));
      });

      it('settles the leftover run and starts the new one', async () => {
        const ended = SIX_HOURS_AGO();
        const { taskId, topicId } = await seedBlockedScheduledTask({
          completedAt: ended,
          status: 'done',
          updatedAt: ended,
        });

        await caller.run({ id: taskId });

        const runs = await new TaskTopicModel(serverDB, userId).findByTaskId(taskId);
        expect(runs.map((run) => [run.topicId, run.status]).sort()).toEqual(
          [
            [testTopicId, 'running'],
            [topicId, 'completed'],
          ].sort(),
        );
        expect(mockExecAgent).toHaveBeenCalledTimes(1);
      });

      it('lets the leftover topic itself be continued', async () => {
        const ended = SIX_HOURS_AGO();
        const { taskId, topicId } = await seedBlockedScheduledTask({
          completedAt: ended,
          status: 'done',
          updatedAt: ended,
        });

        await caller.run({ continueTopicId: topicId, id: taskId });

        expect(mockExecAgent).toHaveBeenCalledWith(
          expect.objectContaining({ appContext: expect.objectContaining({ topicId }) }),
        );
      });

      it('still refuses a run that is live, naming its operation and state', async () => {
        const { operationId, taskId, topicId } = await seedBlockedScheduledTask({
          status: 'running',
          updatedAt: new Date(),
        });

        await expect(caller.run({ id: taskId })).rejects.toThrow(
          new RegExp(
            `running topic \\(${topicId}\\): operation ${operationId} is running .*lh task topic cancel ${topicId}`,
          ),
        );
        expect(mockExecAgent).not.toHaveBeenCalled();
        const [run] = await new TaskTopicModel(serverDB, userId).findByTaskId(taskId);
        expect(run.status).toBe('running');
      });
    });
  });
});
