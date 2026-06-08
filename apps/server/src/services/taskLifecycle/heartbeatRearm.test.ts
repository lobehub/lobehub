// @vitest-environment node
import type { TaskItem, TaskSchedulerContext } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskLifecycleService } from './index';

const fakeScheduler = {
  cancelScheduled: vi.fn().mockResolvedValue(undefined),
  scheduleNextTopic: vi.fn().mockResolvedValue('msg-new'),
};

vi.mock('@/server/services/taskScheduler', () => ({
  createTaskSchedulerModule: () => fakeScheduler,
}));

const baseTask = (overrides: Partial<TaskItem> = {}): TaskItem =>
  ({
    automationMode: 'heartbeat',
    config: {},
    context: {},
    error: null,
    heartbeatInterval: 30,
    heartbeatTimeout: 600,
    id: 'task-1',
    identifier: 'TASK-1',
    name: 'demo',
    status: 'paused',
    ...overrides,
  }) as unknown as TaskItem;

describe('TaskLifecycleService.maybeRearmHeartbeat', () => {
  let service: TaskLifecycleService;
  let updateContext: ReturnType<typeof vi.fn>;
  let hasUnresolvedUrgent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fakeScheduler.scheduleNextTopic.mockClear().mockResolvedValue('msg-new');
    fakeScheduler.cancelScheduled.mockClear().mockResolvedValue(undefined);

    service = new TaskLifecycleService({} as any, 'user-1');

    updateContext = vi.fn().mockResolvedValue(null);
    hasUnresolvedUrgent = vi.fn().mockResolvedValue(false);

    (service as any).taskModel.updateContext = updateContext;
    (service as any).briefModel.hasUnresolvedUrgentByTask = hasUnresolvedUrgent;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const rearm = (task: TaskItem, reason: string) =>
    (service as any).maybeRearmHeartbeat(task, reason);

  it('schedules next tick and writes scheduler context on done', async () => {
    await rearm(baseTask(), 'done');

    expect(fakeScheduler.scheduleNextTopic).toHaveBeenCalledWith({
      delay: 30,
      taskId: 'task-1',
      userId: 'user-1',
    });
    expect(updateContext).toHaveBeenCalledWith('task-1', {
      scheduler: expect.objectContaining({
        consecutiveFailures: 0,
        tickMessageId: 'msg-new',
      }),
    });
  });

  it('skips when automationMode is not heartbeat', async () => {
    await rearm(baseTask({ automationMode: null }), 'done');

    expect(fakeScheduler.scheduleNextTopic).not.toHaveBeenCalled();
    expect(updateContext).not.toHaveBeenCalled();
  });

  it('skips when heartbeatInterval is missing or zero', async () => {
    await rearm(baseTask({ heartbeatInterval: 0 }), 'done');
    await rearm(baseTask({ heartbeatInterval: null }), 'done');

    expect(fakeScheduler.scheduleNextTopic).not.toHaveBeenCalled();
  });

  it.each(['completed', 'failed', 'canceled'])('skips on terminal status %s', async (status) => {
    await rearm(baseTask({ status }), 'done');

    expect(fakeScheduler.scheduleNextTopic).not.toHaveBeenCalled();
  });

  it('skips when a non-error unresolved urgent brief exists, but persists failure count', async () => {
    hasUnresolvedUrgent.mockResolvedValue(true);

    await rearm(baseTask(), 'error');

    expect(hasUnresolvedUrgent).toHaveBeenCalledWith('task-1', { excludeTypes: ['error'] });
    expect(fakeScheduler.scheduleNextTopic).not.toHaveBeenCalled();
    expect(updateContext).toHaveBeenCalledWith('task-1', {
      scheduler: { consecutiveFailures: 1 },
    });
  });

  it('does NOT block re-arm on an error brief — fuse alone governs error retries', async () => {
    // Caller passes excludeTypes: ['error'], so brief query returns false even
    // when there's a fresh error brief. The first error must still schedule
    // the next tick so the fuse can count up to 3.
    hasUnresolvedUrgent.mockResolvedValue(false);

    await rearm(baseTask(), 'error');

    expect(hasUnresolvedUrgent).toHaveBeenCalledWith('task-1', { excludeTypes: ['error'] });
    expect(fakeScheduler.scheduleNextTopic).toHaveBeenCalled();
    expect(updateContext).toHaveBeenCalledWith('task-1', {
      scheduler: expect.objectContaining({ consecutiveFailures: 1 }),
    });
  });

  it('increments consecutiveFailures on error', async () => {
    const ctx: { scheduler: TaskSchedulerContext } = {
      scheduler: { consecutiveFailures: 1 },
    };

    await rearm(baseTask({ context: ctx }), 'error');

    expect(fakeScheduler.scheduleNextTopic).toHaveBeenCalled();
    expect(updateContext).toHaveBeenCalledWith('task-1', {
      scheduler: expect.objectContaining({ consecutiveFailures: 2 }),
    });
  });

  it('blows the fuse at 3 consecutive errors and stops re-arming', async () => {
    const ctx: { scheduler: TaskSchedulerContext } = {
      scheduler: { consecutiveFailures: 2 },
    };

    await rearm(baseTask({ context: ctx }), 'error');

    expect(fakeScheduler.scheduleNextTopic).not.toHaveBeenCalled();
    expect(updateContext).toHaveBeenCalledWith('task-1', {
      scheduler: { consecutiveFailures: 3 },
    });
  });

  it('resets consecutiveFailures on done', async () => {
    const ctx: { scheduler: TaskSchedulerContext } = {
      scheduler: { consecutiveFailures: 2, tickMessageId: 'old-msg' },
    };

    await rearm(baseTask({ context: ctx }), 'done');

    expect(fakeScheduler.cancelScheduled).toHaveBeenCalledWith('old-msg');
    expect(fakeScheduler.scheduleNextTopic).toHaveBeenCalled();
    expect(updateContext).toHaveBeenCalledWith('task-1', {
      scheduler: expect.objectContaining({
        consecutiveFailures: 0,
        tickMessageId: 'msg-new',
      }),
    });
  });
});
