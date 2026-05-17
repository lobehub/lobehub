// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';

import { TaskRunnerService } from './index';
import { runScheduleTick } from './scheduleTick';

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(),
}));

vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: vi.fn(),
}));

vi.mock('@/database/models/brief', () => ({
  BriefModel: vi.fn(),
}));

vi.mock('./index', () => ({
  TaskRunnerService: vi.fn(),
}));

describe('runScheduleTick', () => {
  const taskId = 'task-1';
  const userId = 'user-1';

  const mockTaskModel = {
    findById: vi.fn(),
    updateStatus: vi.fn(),
  };
  const mockTaskTopicModel = {
    countByTask: vi.fn(),
  };
  const mockBriefModel = {
    hasUnresolvedUrgentByTask: vi.fn().mockResolvedValue(false),
  };
  const mockRunner = {
    runTask: vi.fn(),
  };

  const baseTask = (overrides: Partial<Record<string, unknown>> = {}) => ({
    automationMode: 'schedule',
    config: {},
    context: { scheduler: { scheduleStartedAt: new Date('2026-05-01T00:00:00Z').toISOString() } },
    id: taskId,
    identifier: 'T-1',
    schedulePattern: '*/5 * * * *',
    status: 'scheduled',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockBriefModel.hasUnresolvedUrgentByTask.mockResolvedValue(false);
    (TaskModel as any).mockImplementation(() => mockTaskModel);
    (TaskTopicModel as any).mockImplementation(() => mockTaskTopicModel);
    (BriefModel as any).mockImplementation(() => mockBriefModel);
    (TaskRunnerService as any).mockImplementation(() => mockRunner);
  });

  it('skips not-found tasks', async () => {
    mockTaskModel.findById.mockResolvedValue(null);

    const outcome = await runScheduleTick(taskId, userId);

    expect(outcome).toEqual({ ran: false, reason: 'not-found' });
    expect(mockRunner.runTask).not.toHaveBeenCalled();
  });

  it('skips when automationMode has been changed away from schedule', async () => {
    mockTaskModel.findById.mockResolvedValue(baseTask({ automationMode: 'heartbeat' }));

    const outcome = await runScheduleTick(taskId, userId);

    expect(outcome).toEqual({ ran: false, reason: 'mode-changed' });
    expect(mockRunner.runTask).not.toHaveBeenCalled();
  });

  it('skips terminal / paused tasks before checking maxExecutions', async () => {
    mockTaskModel.findById.mockResolvedValue(baseTask({ status: 'paused' }));

    const outcome = await runScheduleTick(taskId, userId);

    expect(outcome).toEqual({ ran: false, reason: 'paused' });
    expect(mockTaskTopicModel.countByTask).not.toHaveBeenCalled();
  });

  it('runs the task when no maxExecutions is configured', async () => {
    mockTaskModel.findById.mockResolvedValue(baseTask({ config: {} }));
    mockRunner.runTask.mockResolvedValue(undefined);

    const outcome = await runScheduleTick(taskId, userId);

    expect(outcome).toEqual({ ran: true, taskIdentifier: 'T-1' });
    expect(mockTaskTopicModel.countByTask).not.toHaveBeenCalled();
    expect(mockRunner.runTask).toHaveBeenCalledWith({ taskId });
  });

  it('runs the task when the run count is still under maxExecutions', async () => {
    mockTaskModel.findById.mockResolvedValue(
      baseTask({ config: { schedule: { maxExecutions: 10 } } }),
    );
    mockTaskTopicModel.countByTask.mockResolvedValue(7);
    mockRunner.runTask.mockResolvedValue(undefined);

    const outcome = await runScheduleTick(taskId, userId);

    expect(outcome).toEqual({ ran: true, taskIdentifier: 'T-1' });
    expect(mockTaskTopicModel.countByTask).toHaveBeenCalledWith(taskId, {
      since: new Date('2026-05-01T00:00:00Z'),
    });
    expect(mockRunner.runTask).toHaveBeenCalledWith({ taskId });
    expect(mockTaskModel.updateStatus).not.toHaveBeenCalled();
  });

  it('marks the task completed and skips when the run count has reached maxExecutions', async () => {
    mockTaskModel.findById.mockResolvedValue(
      baseTask({ config: { schedule: { maxExecutions: 10 } } }),
    );
    mockTaskTopicModel.countByTask.mockResolvedValue(10);

    const outcome = await runScheduleTick(taskId, userId);

    expect(outcome).toEqual({ ran: false, reason: 'max-executions-reached' });
    expect(mockRunner.runTask).not.toHaveBeenCalled();
    expect(mockTaskModel.updateStatus).toHaveBeenCalledWith(taskId, 'completed', {
      completedAt: expect.any(Date),
    });
  });

  it('falls back to running when maxExecutions is set but scheduleStartedAt is missing', async () => {
    // Pre-existing scheduled tasks (created before this PR) won't have a
    // scheduleStartedAt stamp. They should still tick normally; the cap will
    // start enforcing once the user pauses + restarts.
    mockTaskModel.findById.mockResolvedValue(
      baseTask({ config: { schedule: { maxExecutions: 10 } }, context: {} }),
    );
    mockRunner.runTask.mockResolvedValue(undefined);

    const outcome = await runScheduleTick(taskId, userId);

    expect(outcome).toEqual({ ran: true, taskIdentifier: 'T-1' });
    expect(mockTaskTopicModel.countByTask).not.toHaveBeenCalled();
    expect(mockRunner.runTask).toHaveBeenCalled();
  });

  it('returns in-flight when runTask raises a CONFLICT', async () => {
    mockTaskModel.findById.mockResolvedValue(baseTask({ config: {} }));
    mockRunner.runTask.mockRejectedValue(new TRPCError({ code: 'CONFLICT', message: 'busy' }));

    const outcome = await runScheduleTick(taskId, userId);

    expect(outcome).toEqual({ ran: false, reason: 'in-flight' });
  });

  it('skips when a human is waiting on an urgent brief', async () => {
    mockTaskModel.findById.mockResolvedValue(baseTask({ config: {} }));
    mockBriefModel.hasUnresolvedUrgentByTask.mockResolvedValue(true);

    const outcome = await runScheduleTick(taskId, userId);

    expect(outcome).toEqual({ ran: false, reason: 'human-waiting' });
    expect(mockRunner.runTask).not.toHaveBeenCalled();
  });
});
