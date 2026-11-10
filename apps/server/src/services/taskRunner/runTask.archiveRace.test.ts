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
 * Archiving hides a task from every list, so the runner must never start one:
 * neither an already archived task nor one archived while this run is starting.
 */
describe('TaskRunnerService.runTask vs. archiving', () => {
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
      findById: vi.fn().mockResolvedValue({ ...task, status: 'running' }),
      getUnlockedTasksForMany: vi.fn().mockResolvedValue([]),
      lockForUpdate: vi.fn().mockResolvedValue(true),
      findById: vi.fn().mockResolvedValue({ ...task }),
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

  it('refuses an archived task before touching its status', async () => {
    taskModel.findById.mockResolvedValue({ ...task, archivedAt: new Date() });

    await expect(
      new TaskRunnerService(db, 'user-1').runTask({ taskId: 'T-1' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    expect(taskModel.updateStatusIfCurrent).not.toHaveBeenCalled();
    expect(mocks.execAgent).not.toHaveBeenCalled();
  });

  it('hands the status back when an archive lands between the read and the start', async () => {
    // The conditional `-> running` write returns the latest row, which already
    // carries the concurrent archive.
    taskModel.updateStatusIfCurrent
      .mockResolvedValueOnce({ ...task, archivedAt: new Date(), status: 'running' })
      .mockResolvedValueOnce({ ...task, archivedAt: new Date(), status: 'backlog' });

    await expect(
      new TaskRunnerService(db, 'user-1').runTask({ taskId: 'T-1' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    expect(taskModel.updateStatusIfCurrent).toHaveBeenLastCalledWith(
      'task-1',
      'running',
      'backlog',
      { error: null },
    );
    expect(mocks.execAgent).not.toHaveBeenCalled();
  });

  describe('completion cascade', () => {
    it('leaves an archived dependent idle instead of marking it failed', async () => {
      taskModel.getUnlockedTasksForMany.mockResolvedValue([
        { ...task, archivedAt: new Date(), id: 'task-2', identifier: 'T-2' },
      ]);

      const result = await new TaskRunnerService(db, 'user-1').cascadeOnCompletionMany(['task-0']);

      expect(result).toMatchObject({ failed: [], paused: [], started: [] });
      expect(taskModel.updateStatus).not.toHaveBeenCalled();
      expect(mocks.execAgent).not.toHaveBeenCalled();
    });

    it('treats a dependent archived after discovery as skipped, not failed', async () => {
      taskModel.getUnlockedTasksForMany.mockResolvedValue([{ ...task, id: 'task-2' }]);
      // The runner re-reads the task and finds it archived.
      taskModel.findById.mockResolvedValue({ ...task, archivedAt: new Date(), id: 'task-2' });

      const result = await new TaskRunnerService(db, 'user-1').cascadeOnCompletionMany(['task-0']);

      expect(result.failed).toEqual([]);
      expect(taskModel.updateStatus).not.toHaveBeenCalled();
    });
  });
});
