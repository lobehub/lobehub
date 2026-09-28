import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';

import { TaskRunnerService } from './index';

const mocks = vi.hoisted(() => ({
  execAgent: vi.fn(),
  interruptTask: vi.fn(),
}));

vi.mock('@/database/models/task', () => ({ TaskModel: vi.fn() }));
vi.mock('@/database/models/taskTopic', () => ({ TaskTopicModel: vi.fn() }));
vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return { getAgentModelConfig: vi.fn() };
  }),
}));
vi.mock('@/database/models/brief', () => ({ BriefModel: vi.fn() }));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return { execAgent: mocks.execAgent, interruptTask: mocks.interruptTask };
  }),
}));
vi.mock('@/server/services/taskLifecycle', () => ({ TaskLifecycleService: vi.fn() }));
vi.mock('./buildTaskPrompt', () => ({
  buildTaskPrompt: vi.fn().mockResolvedValue({
    acceptanceEnabled: false,
    fileIds: [],
    prompt: 'do it',
  }),
}));

/**
 * A delete can land while `execAgent` is dispatching, before the run's topic
 * and operation are recorded — so the delete finds nothing to interrupt. The
 * runner records under the task's row lock; when the task is already gone it
 * must stop the run it just dispatched instead of leaving it orphaned.
 */
describe('TaskRunnerService.runTask vs. a concurrent delete', () => {
  const task = {
    assigneeAgentId: 'agt_worker',
    config: { model: 'm', provider: 'p' },
    id: 'task-1',
    identifier: 'T-1',
    status: 'backlog',
    totalTopics: 0,
  };
  let taskModel: Record<string, ReturnType<typeof vi.fn>>;
  let taskTopicModel: Record<string, ReturnType<typeof vi.fn>>;
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    taskModel = {
      getCheckpointConfig: vi.fn().mockReturnValue({}),
      getReviewConfig: vi.fn().mockReturnValue(undefined),
      incrementTopicCount: vi.fn(),
      lockForUpdate: vi.fn().mockResolvedValue(true),
      resolve: vi.fn().mockResolvedValue({ ...task }),
      update: vi.fn(),
      updateCurrentTopic: vi.fn(),
      updateHeartbeat: vi.fn(),
      updateStatus: vi.fn(),
      updateStatusIfCurrent: vi.fn().mockResolvedValue({ ...task, status: 'running' }),
    };
    taskTopicModel = {
      add: vi.fn(),
      findByTaskId: vi.fn().mockResolvedValue([]),
      updateStatus: vi.fn(),
    };
    vi.mocked(TaskModel).mockImplementation(function () {
      return taskModel as any;
    });
    vi.mocked(TaskTopicModel).mockImplementation(function () {
      return taskTopicModel as any;
    });
    mocks.execAgent.mockResolvedValue({
      operationId: 'op-new',
      success: true,
      topicId: 'tpc-new',
    });
    mocks.interruptTask.mockResolvedValue({ success: true });
  });

  it('records the run under the task lock when the task still exists', async () => {
    await new TaskRunnerService(db, 'user-1').runTask({ taskId: 'T-1' });

    expect(taskModel.lockForUpdate).toHaveBeenCalledWith('task-1');
    expect(taskTopicModel.add).toHaveBeenCalledWith(
      'task-1',
      'tpc-new',
      expect.objectContaining({ operationId: 'op-new' }),
    );
    expect(mocks.interruptTask).not.toHaveBeenCalled();
  });

  it('stops the run it just dispatched when the task was deleted meanwhile', async () => {
    taskModel.lockForUpdate.mockResolvedValue(false);

    await expect(new TaskRunnerService(db, 'user-1').runTask({ taskId: 'T-1' })).rejects.toThrow(
      'The task was deleted while its run was starting',
    );

    expect(mocks.interruptTask).toHaveBeenCalledWith({ operationId: 'op-new' });
    expect(taskTopicModel.add).not.toHaveBeenCalled();
  });

  it.each([{ success: false }, { deviceCancellationConfirmed: false, success: true }])(
    'does not claim the orphaned run stopped when the stop is unconfirmed (%j)',
    async (stop) => {
      taskModel.lockForUpdate.mockResolvedValue(false);
      mocks.interruptTask.mockResolvedValue(stop);

      await expect(
        new TaskRunnerService(db, 'user-1').runTask({ taskId: 'T-1' }),
      ).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: expect.stringContaining('could not be confirmed'),
      });
    },
  );

  it('does not dispatch at all when the task changed before its run could start', async () => {
    taskModel.updateStatusIfCurrent.mockResolvedValue(null);

    await expect(new TaskRunnerService(db, 'user-1').runTask({ taskId: 'T-1' })).rejects.toThrow(
      'The task changed or was deleted before its run could start',
    );

    expect(mocks.execAgent).not.toHaveBeenCalled();
  });
});
