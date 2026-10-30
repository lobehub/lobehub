// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskService } from './index';

/**
 * Completing a task: the parent checkpoint pause, the all-siblings-done
 * signal, and the dependency cascade the runner starts.
 */
const mocks = vi.hoisted(() => ({
  areAllSubtasksCompleted: vi.fn(),
  cascadeOnCompletion: vi.fn(),
  findById: vi.fn(),
  shouldPauseAfterComplete: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/project', () => ({ ProjectModel: vi.fn() }));
vi.mock('@/database/models/topic', () => ({ TopicModel: vi.fn() }));
vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: vi.fn(function () {
    return { findByTaskId: vi.fn().mockResolvedValue([]) };
  }),
}));
vi.mock('@/database/models/task', () => ({
  taskActivityActor: vi.fn(),
  TaskModel: vi.fn(function () {
    return {
      areAllSubtasksCompleted: mocks.areAllSubtasksCompleted,
      findById: mocks.findById,
      shouldPauseAfterComplete: mocks.shouldPauseAfterComplete,
      updateStatus: mocks.updateStatus,
    };
  }),
}));
vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: vi.fn() }));
vi.mock('@/server/services/taskRunner', () => ({
  TaskRunnerService: vi.fn(function () {
    return { cascadeOnCompletion: mocks.cascadeOnCompletion };
  }),
}));

const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)) };

const subtask = {
  id: 'task-2',
  identifier: 'T-2',
  parentTaskId: 'task-1',
  status: 'running',
};

describe('TaskService.updateStatus completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findById.mockResolvedValueOnce({ ...subtask, status: 'todo' });
    mocks.updateStatus.mockImplementation(async (id: string, status: string) => ({
      ...subtask,
      id,
      status,
    }));
    mocks.findById.mockResolvedValue({ id: 'task-1', identifier: 'T-1' });
    mocks.cascadeOnCompletion.mockResolvedValue({ paused: ['T-9'], started: ['T-3'] });
  });

  it('pauses the parent at its checkpoint and reports the finished family', async () => {
    mocks.shouldPauseAfterComplete.mockReturnValue(true);
    mocks.areAllSubtasksCompleted.mockResolvedValue(true);

    const result = await new TaskService(db as any, 'user-1').updateStatus({
      id: 'task-2',
      status: 'completed',
    });

    expect(mocks.shouldPauseAfterComplete).toHaveBeenCalledWith(
      { id: 'task-1', identifier: 'T-1' },
      expect.objectContaining({ id: 'task-2', identifier: 'T-2' }),
    );
    expect(mocks.updateStatus).toHaveBeenCalledWith('task-1', 'paused');
    expect(mocks.areAllSubtasksCompleted).toHaveBeenCalledWith('task-1');
    expect(mocks.cascadeOnCompletion).toHaveBeenCalledWith('task-2');
    expect(result).toMatchObject({
      allSubtasksDone: true,
      checkpointTriggered: true,
      parentTaskId: 'task-1',
      paused: ['T-9'],
      unlocked: ['T-3'],
    });
  });

  it('omits the checkpoint and family flags when neither applies', async () => {
    mocks.shouldPauseAfterComplete.mockReturnValue(false);
    mocks.areAllSubtasksCompleted.mockResolvedValue(false);

    const result = await new TaskService(db as any, 'user-1').updateStatus({
      id: 'task-2',
      status: 'completed',
    });

    expect(mocks.updateStatus).not.toHaveBeenCalledWith('task-1', 'paused');
    expect(result).not.toHaveProperty('checkpointTriggered');
    expect(result).not.toHaveProperty('allSubtasksDone');
    expect(result).toMatchObject({ paused: ['T-9'], unlocked: ['T-3'] });
  });

  it('rejects an error message on a non-failed status before reading the task', async () => {
    await expect(
      new TaskService(db as any, 'user-1').updateStatus({
        error: 'boom',
        id: 'task-2',
        status: 'completed',
      }),
    ).rejects.toThrow('Task error can only be provided when status is failed.');
    expect(mocks.findById).not.toHaveBeenCalled();
  });
});
