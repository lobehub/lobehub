// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskService } from './index';

/**
 * A user (re)starting a scheduled task opens a fresh run-count window and
 * clears the failure fuse, so a task the fuse paused gets a fresh run of
 * attempts instead of re-pausing on its first failure after the resume.
 */
const mocks = vi.hoisted(() => ({
  areAllSubtasksCompleted: vi.fn(),
  cascadeOnCompletion: vi.fn(),
  findById: vi.fn(),
  onTaskSettled: vi.fn(),
  updateContext: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('@/business/server/task/onTaskSettled', () => ({ onTaskSettled: mocks.onTaskSettled }));

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
      updateContext: mocks.updateContext,
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

const scheduleTask = (overrides: Record<string, unknown> = {}) => ({
  automationMode: 'schedule',
  context: {},
  id: 'task-1',
  identifier: 'T-1',
  parentTaskId: null,
  status: 'backlog',
  ...overrides,
});

const restartPatch = {
  scheduler: {
    consecutiveFailures: 0,
    pauseCause: null,
    scheduleStartedAt: expect.any(String),
  },
};

describe('TaskService.updateStatus schedule restart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateStatus.mockImplementation(async (id: string, status: string) =>
      scheduleTask({ id, status }),
    );
  });

  it('opens the run window when a user starts a schedule (backlog → scheduled)', async () => {
    mocks.findById.mockResolvedValue(scheduleTask({ status: 'backlog' }));

    await new TaskService(db as any, 'user-1').updateStatus({ id: 'T-1', status: 'scheduled' });

    expect(mocks.updateContext).toHaveBeenCalledTimes(1);
    expect(mocks.updateContext).toHaveBeenCalledWith('task-1', restartPatch);
    const stamped = mocks.updateContext.mock.calls[0]![1].scheduler.scheduleStartedAt as string;
    expect(() => new Date(stamped).toISOString()).not.toThrow();
  });

  it('clears the fuse and its cause when a user resumes a fuse-paused task', async () => {
    mocks.findById.mockResolvedValue(
      scheduleTask({
        context: { scheduler: { consecutiveFailures: 3, pauseCause: 'insufficientBudget' } },
        status: 'paused',
      }),
    );

    await new TaskService(db as any, 'user-1').updateStatus({ id: 'T-1', status: 'scheduled' });

    expect(mocks.updateContext).toHaveBeenCalledWith('task-1', restartPatch);
  });
});
