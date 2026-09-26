import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleDispatch } from '../scheduleDispatch';

const mocks = vi.hoisted(() => ({
  appEnv: { enableQueueAgentRuntime: false },
  getScheduledTasks: vi.fn(),
  getServerDB: vi.fn(),
  publishJSON: vi.fn(),
  swapDispatchedScheduleOccurrence: vi.fn(),
}));

vi.mock('@/database/server', () => ({ getServerDB: mocks.getServerDB }));

vi.mock('@/database/models/task', () => ({
  TaskModel: {
    getScheduledTasks: mocks.getScheduledTasks,
    swapDispatchedScheduleOccurrence: mocks.swapDispatchedScheduleOccurrence,
  },
}));

vi.mock('@/envs/app', () => ({ appEnv: mocks.appEnv }));

vi.mock('@/libs/qstash', () => ({ qstashClient: { publishJSON: mocks.publishJSON } }));

vi.mock('@/server/services/taskRunner/scheduleTick', () => ({ runScheduleTick: vi.fn() }));

const dispatch = async (dryRun: boolean) => {
  const app = new Hono();
  app.post('/schedule-dispatch', scheduleDispatch);
  const res = await app.request('/schedule-dispatch', {
    body: JSON.stringify({ dryRun }),
    method: 'POST',
  });
  return (await res.json()) as { dispatched: number; due: number; total: number };
};

const dryRun = () => dispatch(true);

const dailyNineTask = (context: unknown) => ({
  context,
  createdByUserId: 'user-1',
  id: 'task-1',
  identifier: 'T-1',
  lastHeartbeatAt: null,
  schedulePattern: '0 9 * * *',
  scheduleTimezone: 'UTC',
});

describe('scheduleDispatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // The 09:10 tick, right after a 09:00 slot.
    vi.setSystemTime(new Date('2026-09-21T09:10:00Z'));
    mocks.getServerDB.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    mocks.appEnv.enableQueueAgentRuntime = false;
  });

  it('does not fire a slot that passed before the schedule was armed', async () => {
    mocks.getScheduledTasks.mockResolvedValue([
      dailyNineTask({ scheduler: { scheduleStartedAt: '2026-09-21T09:05:00.000Z' } }),
    ]);

    expect(await dryRun()).toMatchObject({ due: 0, total: 1 });
  });

  it('fires the slot when the schedule was armed before it', async () => {
    mocks.getScheduledTasks.mockResolvedValue([
      dailyNineTask({ scheduler: { scheduleStartedAt: '2026-09-21T08:55:00.000Z' } }),
    ]);

    expect(await dryRun()).toMatchObject({ due: 1, total: 1 });
  });

  it('keeps firing tasks that were armed before the stamp existed', async () => {
    mocks.getScheduledTasks.mockResolvedValue([dailyNineTask(null)]);

    expect(await dryRun()).toMatchObject({ due: 1, total: 1 });
  });

  describe('occurrence reservation', () => {
    const armed = { scheduleStartedAt: '2026-09-21T08:55:00.000Z' };

    beforeEach(() => {
      mocks.appEnv.enableQueueAgentRuntime = true;
      vi.stubEnv('APP_URL', 'https://app.test');
      mocks.publishJSON.mockResolvedValue({ messageId: 'msg-1' });
    });

    it('does not re-dispatch an occurrence whose delivery is still queued', async () => {
      // The 09:00 occurrence was published on the 09:00 tick but its run has
      // not started, so lastHeartbeatAt still predates it on the 09:10 tick.
      mocks.getScheduledTasks.mockResolvedValue([
        dailyNineTask({
          scheduler: { ...armed, lastDispatchedOccurrenceAt: '2026-09-21T09:00:00.000Z' },
        }),
      ]);

      expect(await dryRun()).toMatchObject({ due: 0, total: 1 });
    });

    it('reserves the occurrence before publishing it', async () => {
      mocks.getScheduledTasks.mockResolvedValue([dailyNineTask({ scheduler: armed })]);
      mocks.swapDispatchedScheduleOccurrence.mockResolvedValue(true);

      expect(await dispatch(false)).toMatchObject({ dispatched: 1, due: 1 });
      expect(mocks.swapDispatchedScheduleOccurrence).toHaveBeenCalledWith(
        {},
        'task-1',
        null,
        '2026-09-21T09:00:00.000Z',
      );
      expect(mocks.publishJSON).toHaveBeenCalledTimes(1);
    });

    it('does not publish when another dispatcher already reserved the occurrence', async () => {
      mocks.getScheduledTasks.mockResolvedValue([dailyNineTask({ scheduler: armed })]);
      mocks.swapDispatchedScheduleOccurrence.mockResolvedValue(false);

      expect(await dispatch(false)).toMatchObject({ dispatched: 0, due: 1 });
      expect(mocks.publishJSON).not.toHaveBeenCalled();
    });

    it('releases the reservation when publishing fails', async () => {
      mocks.getScheduledTasks.mockResolvedValue([dailyNineTask({ scheduler: armed })]);
      mocks.swapDispatchedScheduleOccurrence.mockResolvedValue(true);
      mocks.publishJSON.mockRejectedValue(new Error('qstash down'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(await dispatch(false)).toMatchObject({ dispatched: 0, due: 1 });
      expect(mocks.swapDispatchedScheduleOccurrence).toHaveBeenLastCalledWith(
        {},
        'task-1',
        '2026-09-21T09:00:00.000Z',
        null,
      );
    });
  });
});
