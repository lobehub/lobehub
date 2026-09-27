// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { rehydrateHeartbeatTasks, scheduleHeartbeatRecoveryOnce } from './heartbeatRecovery';

const {
  mockBriefModelCtor,
  mockFindRunnableHeartbeatTasks,
  mockHasUnresolvedUrgent,
  mockQueueMode,
  mockScheduleNextTopic,
  mockTaskModelCtor,
  mockUpdateContext,
} = vi.hoisted(() => ({
  mockBriefModelCtor: vi.fn(),
  mockFindRunnableHeartbeatTasks: vi.fn(),
  mockHasUnresolvedUrgent: vi.fn(),
  mockQueueMode: { enabled: false },
  mockScheduleNextTopic: vi.fn(),
  mockTaskModelCtor: vi.fn(),
  mockUpdateContext: vi.fn(),
}));

vi.mock('@/database/models/brief', () => ({
  BriefModel: mockBriefModelCtor,
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: Object.assign(mockTaskModelCtor, {
    findRunnableHeartbeatTasks: mockFindRunnableHeartbeatTasks,
  }),
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    get enableQueueAgentRuntime() {
      return mockQueueMode.enabled;
    },
  },
}));

vi.mock('@/server/services/taskLifecycle', () => ({
  AUTOMATION_FAILURE_FUSE: 3,
}));

vi.mock('@/server/services/taskScheduler', () => ({
  createTaskSchedulerModule: () => ({ scheduleNextTopic: mockScheduleNextTopic }),
}));

const globalForRecovery = globalThis as typeof globalThis & {
  __lobeHeartbeatRecoveryStarted?: boolean;
};

const baseTask = (overrides: Record<string, unknown> = {}) => ({
  automationMode: 'heartbeat',
  context: {
    scheduler: {
      consecutiveFailures: 1,
      scheduledAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      tickMessageId: 'msg-old',
      tickToken: 'tok-old',
    },
  },
  createdByUserId: 'user-1',
  heartbeatInterval: 30,
  id: 'task-1',
  identifier: 'T-1',
  status: 'scheduled',
  workspaceId: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockQueueMode.enabled = false;
  mockTaskModelCtor.mockImplementation(() => ({ updateContext: mockUpdateContext }));
  mockBriefModelCtor.mockImplementation(() => ({
    hasUnresolvedUrgentByTask: mockHasUnresolvedUrgent,
  }));
  mockHasUnresolvedUrgent.mockResolvedValue(false);
  mockUpdateContext.mockResolvedValue(null);
  mockScheduleNextTopic.mockResolvedValue('tick-new');
  mockFindRunnableHeartbeatTasks.mockResolvedValue([]);
  delete globalForRecovery.__lobeHeartbeatRecoveryStarted;
});

describe('rehydrateHeartbeatTasks', () => {
  it('is a no-op in QStash mode — ticks persist server-side there', async () => {
    mockQueueMode.enabled = true;

    await expect(rehydrateHeartbeatTasks()).resolves.toEqual({ rehydrated: 0 });

    expect(mockFindRunnableHeartbeatTasks).not.toHaveBeenCalled();
    expect(mockScheduleNextTopic).not.toHaveBeenCalled();
  });

  it('re-arms an overdue tick on the floor delay with a fresh generation', async () => {
    mockFindRunnableHeartbeatTasks.mockResolvedValue([baseTask()]);

    await expect(rehydrateHeartbeatTasks()).resolves.toEqual({ rehydrated: 1 });

    expect(mockTaskModelCtor).toHaveBeenCalledWith({}, 'user-1', undefined);
    expect(mockScheduleNextTopic).toHaveBeenCalledTimes(1);
    const schedule = mockScheduleNextTopic.mock.calls[0][0];
    expect(schedule).toMatchObject({ delay: 3, taskId: 'task-1', userId: 'user-1' });

    // Token is written first (invalidate the dead generation), then the full
    // scheduler context after the tick is scheduled.
    expect(mockUpdateContext).toHaveBeenCalledTimes(2);
    const [, tokenWrite] = mockUpdateContext.mock.calls[0];
    expect(tokenWrite).toEqual({ scheduler: { tickToken: expect.any(String) } });
    const [, fullWrite] = mockUpdateContext.mock.calls[1];
    expect(fullWrite).toEqual({
      scheduler: {
        consecutiveFailures: 1,
        scheduledAt: expect.any(String),
        tickMessageId: 'tick-new',
        tickToken: schedule.tickToken,
      },
    });
  });

  it('resumes the remaining wait for a tick still in the future', async () => {
    mockFindRunnableHeartbeatTasks.mockResolvedValue([
      baseTask({
        context: { scheduler: { scheduledAt: new Date(Date.now() - 10_000).toISOString() } },
        heartbeatInterval: 3600,
      }),
    ]);

    await rehydrateHeartbeatTasks();

    const { delay } = mockScheduleNextTopic.mock.calls[0][0];
    // 3600s interval armed 10s ago → ~3590s remaining.
    expect(delay).toBeGreaterThan(3585);
    expect(delay).toBeLessThan(3595);
  });

  it('fires soon when the scheduler context carries no scheduledAt', async () => {
    mockFindRunnableHeartbeatTasks.mockResolvedValue([baseTask({ context: { scheduler: {} } })]);

    await rehydrateHeartbeatTasks();

    expect(mockScheduleNextTopic.mock.calls[0][0].delay).toBe(3);
  });

  it('caps the delay at one interval', async () => {
    mockFindRunnableHeartbeatTasks.mockResolvedValue([baseTask({ heartbeatInterval: 1 })]);

    await rehydrateHeartbeatTasks();

    expect(mockScheduleNextTopic.mock.calls[0][0].delay).toBe(1);
  });

  it('skips a task whose failure fuse has blown — recovery must not resurrect it', async () => {
    mockFindRunnableHeartbeatTasks.mockResolvedValue([
      baseTask({ context: { scheduler: { consecutiveFailures: 3 } } }),
    ]);

    await expect(rehydrateHeartbeatTasks()).resolves.toEqual({ rehydrated: 0 });

    expect(mockScheduleNextTopic).not.toHaveBeenCalled();
    expect(mockUpdateContext).not.toHaveBeenCalled();
  });

  it('skips a task with an unresolved urgent brief waiting on a human', async () => {
    mockFindRunnableHeartbeatTasks.mockResolvedValue([baseTask()]);
    mockHasUnresolvedUrgent.mockResolvedValue(true);

    await expect(rehydrateHeartbeatTasks()).resolves.toEqual({ rehydrated: 0 });

    expect(mockHasUnresolvedUrgent).toHaveBeenCalledWith('task-1', { excludeTypes: ['error'] });
    expect(mockScheduleNextTopic).not.toHaveBeenCalled();
  });

  it('keeps the remaining tasks recoverable when one task fails', async () => {
    mockFindRunnableHeartbeatTasks.mockResolvedValue([
      baseTask({ id: 'task-1', identifier: 'T-1' }),
      baseTask({ createdByUserId: 'user-2', id: 'task-2', identifier: 'T-2' }),
    ]);
    mockUpdateContext.mockRejectedValueOnce(new Error('db down'));

    await expect(rehydrateHeartbeatTasks()).resolves.toEqual({ rehydrated: 1 });

    expect(mockScheduleNextTopic).toHaveBeenCalledTimes(1);
    expect(mockScheduleNextTopic.mock.calls[0][0].taskId).toBe('task-2');
  });

  it('skips nothing extra for an empty sweep', async () => {
    await expect(rehydrateHeartbeatTasks()).resolves.toEqual({ rehydrated: 0 });

    expect(mockScheduleNextTopic).not.toHaveBeenCalled();
    expect(mockUpdateContext).not.toHaveBeenCalled();
  });
});

describe('scheduleHeartbeatRecoveryOnce', () => {
  it('runs the sweep at most once per process', async () => {
    await scheduleHeartbeatRecoveryOnce();
    await scheduleHeartbeatRecoveryOnce();

    expect(mockFindRunnableHeartbeatTasks).toHaveBeenCalledTimes(1);
  });

  it('releases the guard on failure so a later trigger can retry', async () => {
    mockFindRunnableHeartbeatTasks.mockRejectedValueOnce(new Error('db not ready'));

    await scheduleHeartbeatRecoveryOnce();
    await scheduleHeartbeatRecoveryOnce();

    expect(mockFindRunnableHeartbeatTasks).toHaveBeenCalledTimes(2);
  });
});
