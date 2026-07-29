// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BriefModel } from '@/database/models/brief';

import { runHeartbeatTick } from './heartbeatTick';
import { TaskRunnerService } from './index';

const { mockSelectTask, mockSetTaskSchedulerExecutionCallback } = vi.hoisted(() => ({
  mockSelectTask: vi.fn(),
  mockSetTaskSchedulerExecutionCallback: vi.fn(),
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn().mockResolvedValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => mockSelectTask(),
        }),
      }),
    }),
  }),
}));

vi.mock('@/database/models/brief', () => ({
  BriefModel: vi.fn(),
}));

vi.mock('@/server/services/taskScheduler', () => ({
  setTaskSchedulerExecutionCallback: mockSetTaskSchedulerExecutionCallback,
}));

vi.mock('./index', () => ({
  TaskRunnerService: vi.fn(),
}));

describe('runHeartbeatTick', () => {
  const taskId = 'task-1';
  const userId = 'user-1';

  const mockBriefModel = {
    hasUnresolvedUrgentByTask: vi.fn().mockResolvedValue(false),
  };
  const mockRunner = {
    runTask: vi.fn(),
  };

  const baseTask = (overrides: Partial<Record<string, unknown>> = {}) => ({
    automationMode: 'heartbeat',
    heartbeatInterval: 30,
    id: taskId,
    identifier: 'T-1',
    status: 'scheduled',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectTask.mockResolvedValue([]);
    mockBriefModel.hasUnresolvedUrgentByTask.mockResolvedValue(false);
    (BriefModel as any).mockImplementation(() => mockBriefModel);
    (TaskRunnerService as any).mockImplementation(() => mockRunner);
  });

  it('runs the task and excludes transient error briefs from tick gating', async () => {
    mockSelectTask.mockResolvedValue([baseTask()]);
    mockRunner.runTask.mockResolvedValue(undefined);

    const outcome = await runHeartbeatTick(taskId, userId);

    expect(outcome).toEqual({ ran: true, taskIdentifier: 'T-1' });
    expect(mockBriefModel.hasUnresolvedUrgentByTask).toHaveBeenCalledWith(taskId, {
      excludeTypes: ['error'],
    });
    expect(mockRunner.runTask).toHaveBeenCalledWith({ taskId, trigger: 'heartbeat' });
  });

  it('still skips when a non-error urgent brief requires human input', async () => {
    mockSelectTask.mockResolvedValue([baseTask()]);
    mockBriefModel.hasUnresolvedUrgentByTask.mockResolvedValue(true);

    const outcome = await runHeartbeatTick(taskId, userId);

    expect(outcome).toEqual({ ran: false, reason: 'human-waiting' });
    expect(mockBriefModel.hasUnresolvedUrgentByTask).toHaveBeenCalledWith(taskId, {
      excludeTypes: ['error'],
    });
    expect(mockRunner.runTask).not.toHaveBeenCalled();
  });

  it('returns in-flight when runTask raises a CONFLICT', async () => {
    mockSelectTask.mockResolvedValue([baseTask()]);
    mockRunner.runTask.mockRejectedValue(new TRPCError({ code: 'CONFLICT', message: 'busy' }));

    const outcome = await runHeartbeatTick(taskId, userId);

    expect(outcome).toEqual({ ran: false, reason: 'in-flight' });
  });
});
