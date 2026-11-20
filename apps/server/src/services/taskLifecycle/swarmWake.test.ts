// @vitest-environment node
import type { TaskItem } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskLifecycleService } from './index';

const { findByGraphTask, scheduleGoalAdvance } = vi.hoisted(() => ({
  findByGraphTask: vi.fn(),
  scheduleGoalAdvance: vi.fn(),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn().mockResolvedValue({ generateObject: vi.fn() }),
}));
vi.mock('@/server/services/taskScheduler', () => ({
  createTaskSchedulerModule: () => ({ cancelScheduled: vi.fn(), scheduleNextTopic: vi.fn() }),
}));
vi.mock('@/server/services/taskRunner', () => ({
  TaskRunnerService: vi.fn(function () {
    return { cascadeOnCompletion: vi.fn().mockResolvedValue({ failed: [], paused: [], started: [] }) };
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { findByOperation: vi.fn().mockResolvedValue(undefined) };
  }),
}));
vi.mock('@/database/models/goal', () => ({
  GoalModel: vi.fn(function () {
    return { findByGraphTask };
  }),
}));
vi.mock('@/server/services/goal/scheduler', () => ({ scheduleGoalAdvance }));

const task = {
  automationMode: null,
  config: {},
  context: {},
  id: 'task-1',
  identifier: 'T-1',
  instruction: 'Improve lane A',
  name: 'Lane A',
  parentTaskId: null,
  status: 'running',
} as unknown as TaskItem;

describe('TaskLifecycleService wakes a swarm goal', () => {
  let service: TaskLifecycleService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TaskLifecycleService({} as any, 'user-1', 'ws-1');
    const taskModel = (service as any).taskModel;
    taskModel.findById = vi.fn().mockResolvedValue(task);
    taskModel.updateHeartbeat = vi.fn();
    taskModel.updateStatusIfCurrent = vi.fn();
    taskModel.getCheckpointConfig = vi.fn().mockReturnValue({});
    taskModel.shouldPauseOnTopicComplete = vi.fn().mockReturnValue(false);
    (service as any).taskTopicModel.updateStatus = vi.fn();
    (service as any).taskTopicModel.updateHandoff = vi.fn();
    (service as any).taskTopicModel.updateHandoffContent = vi.fn();
    (service as any).topicModel.update = vi.fn();
    (service as any).messageModel.listLatestTurnAssistantContents = vi.fn().mockResolvedValue([]);
    const systemAgent = (service as any).systemAgentService;
    systemAgent.getTaskModelConfig = vi.fn().mockResolvedValue({ model: 'm', provider: 'p' });
    systemAgent.getUserLocale = vi.fn().mockResolvedValue('en-US');
  });

  const complete = (reason: 'done' | 'error' = 'done') =>
    service.onTopicComplete({
      lastAssistantContent: 'Lane A reached 100.',
      operationId: 'op-1',
      reason,
      runTrigger: 'goal',
      taskId: 'task-1',
      taskIdentifier: 'T-1',
      topicId: 'topic-1',
    } as any);

  // Regression: a lane run has no verification, so nothing woke the
  // coordinator and the finished lane waited for the next sweep to restart.
  it('queues an advance when a lane run of a swarm goal finishes', async () => {
    findByGraphTask.mockResolvedValue({ config: { swarm: { lanes: [], workspace: '/w' } }, id: 'goal-1' });

    await complete();

    expect(scheduleGoalAdvance).toHaveBeenCalledWith({
      goalId: 'goal-1',
      trigger: 'settle',
      userId: 'user-1',
      workspaceId: 'ws-1',
    });
  });

  it('leaves an ordinary goal to its verify settle', async () => {
    findByGraphTask.mockResolvedValue({ config: {}, id: 'goal-1' });

    await complete();

    expect(scheduleGoalAdvance).not.toHaveBeenCalled();
  });
});
