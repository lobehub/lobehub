import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleDispatch } from '../scheduleDispatch';

const mocks = vi.hoisted(() => ({
  appEnv: { enableQueueAgentRuntime: false },
  getScheduledTasks: vi.fn(),
  getServerDB: vi.fn(),
  publishJSON: vi.fn(),
  runScheduleTick: vi.fn(),
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

vi.mock('@/server/services/taskRunner/scheduleTick', () => ({
  runScheduleTick: mocks.runScheduleTick,
}));

const dispatch = async (dryRun: boolean) => {
  const app = new Hono();
  app.post('/schedule-dispatch', scheduleDispatch);
  const res = await app.request('/schedule-dispatch', {
    body: JSON.stringify({ dryRun }),
    method: 'POST',
  });
  return {
    status: res.status,
    ...((await res.json()) as { dispatched: number; due: number; total: number }),
  };
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

    it('releases every reservation when APP_URL is missing', async () => {
      vi.stubEnv('APP_URL', '');
      mocks.getScheduledTasks.mockResolvedValue([dailyNineTask({ scheduler: armed })]);
      mocks.swapDispatchedScheduleOccurrence.mockResolvedValue(true);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(await dispatch(false)).toMatchObject({ status: 500 });
      expect(mocks.publishJSON).not.toHaveBeenCalled();
      expect(mocks.swapDispatchedScheduleOccurrence).toHaveBeenCalledTimes(2);
      expect(mocks.swapDispatchedScheduleOccurrence).toHaveBeenLastCalledWith(
        {},
        'task-1',
        '2026-09-21T09:00:00.000Z',
        null,
      );
    });
  });

  describe('occurrences between ticks', () => {
    const armed = { scheduleStartedAt: '2026-09-21T08:55:00.000Z' };
    const preciseTask = (context: unknown, schedulePattern = '17 9 * * *') => ({
      ...dailyNineTask(context),
      schedulePattern,
    });

    beforeEach(() => {
      mocks.appEnv.enableQueueAgentRuntime = true;
      vi.stubEnv('APP_URL', 'https://example.com');
      mocks.swapDispatchedScheduleOccurrence.mockResolvedValue(true);
      mocks.publishJSON.mockResolvedValue({ messageId: 'm1' });
    });

    afterEach(() => {
      mocks.appEnv.enableQueueAgentRuntime = false;
      vi.unstubAllEnvs();
    });

    it('reserves the occurrence and delays its delivery to the exact minute', async () => {
      mocks.getScheduledTasks.mockResolvedValue([preciseTask({ scheduler: armed })]);

      expect(await dispatch(false)).toMatchObject({ dispatched: 1, due: 1 });
      expect(mocks.swapDispatchedScheduleOccurrence).toHaveBeenCalledWith(
        {},
        'task-1',
        null,
        '2026-09-21T09:17:00.000Z',
      );
      expect(mocks.publishJSON).toHaveBeenCalledWith({
        body: { occurrence: '2026-09-21T09:17:00.000Z', taskId: 'task-1', userId: 'user-1' },
        notBefore: Date.UTC(2026, 8, 21, 9, 17) / 1000,
        url: 'https://example.com/api/workflows/task/schedule-execute',
      });
    });

    it('does not publish again on the tick after the reservation', async () => {
      vi.setSystemTime(new Date('2026-09-21T09:20:00.000Z'));
      mocks.getScheduledTasks.mockResolvedValue([
        preciseTask({
          scheduler: { ...armed, lastDispatchedOccurrenceAt: '2026-09-21T09:17:00.000Z' },
        }),
      ]);

      expect(await dispatch(false)).toMatchObject({ due: 0 });
      expect(mocks.publishJSON).not.toHaveBeenCalled();
    });

    it('fires an earlier time the schedule moved to, past the old reservation', async () => {
      vi.setSystemTime(new Date('2026-09-21T09:20:00.000Z'));
      mocks.getScheduledTasks.mockResolvedValue([
        preciseTask(
          { scheduler: { ...armed, lastDispatchedOccurrenceAt: '2026-09-21T09:17:00.000Z' } },
          '15 9 * * *',
        ),
      ]);

      expect(await dispatch(false)).toMatchObject({ dispatched: 1, due: 1 });
      expect(mocks.swapDispatchedScheduleOccurrence).toHaveBeenCalledWith(
        {},
        'task-1',
        '2026-09-21T09:17:00.000Z',
        '2026-09-21T09:15:00.000Z',
      );
    });

    it('leaves an occurrence on the next tick to that tick', async () => {
      mocks.getScheduledTasks.mockResolvedValue([preciseTask({ scheduler: armed }, '20 9 * * *')]);

      expect(await dispatch(false)).toMatchObject({ due: 0 });
      expect(mocks.publishJSON).not.toHaveBeenCalled();
    });

    it('keeps a due occurrence undelayed', async () => {
      mocks.getScheduledTasks.mockResolvedValue([dailyNineTask({ scheduler: armed })]);

      await dispatch(false);

      expect(mocks.publishJSON).toHaveBeenCalledWith({
        body: { taskId: 'task-1', userId: 'user-1' },
        url: 'https://example.com/api/workflows/task/schedule-execute',
      });
    });
  });

  describe('inline dispatch', () => {
    const armed = { scheduleStartedAt: '2026-09-21T08:55:00.000Z' };

    it('waits for the tick after an occurrence, since nothing can delay delivery', async () => {
      mocks.getScheduledTasks.mockResolvedValue([
        { ...dailyNineTask({ scheduler: armed }), schedulePattern: '17 9 * * *' },
      ]);

      expect(await dispatch(false)).toMatchObject({ due: 0 });
      expect(mocks.swapDispatchedScheduleOccurrence).not.toHaveBeenCalled();
    });

    it('keeps the reservation when the tick succeeds', async () => {
      mocks.getScheduledTasks.mockResolvedValue([dailyNineTask({ scheduler: armed })]);
      mocks.swapDispatchedScheduleOccurrence.mockResolvedValue(true);
      mocks.runScheduleTick.mockResolvedValue({ ran: true, taskIdentifier: 'T-1' });

      expect(await dispatch(false)).toMatchObject({ dispatched: 1, due: 1 });
      expect(mocks.runScheduleTick).toHaveBeenCalledWith('task-1', 'user-1');
      expect(mocks.swapDispatchedScheduleOccurrence).toHaveBeenCalledTimes(1);
    });

    it('releases the reservation when the tick fails', async () => {
      mocks.getScheduledTasks.mockResolvedValue([
        dailyNineTask({
          scheduler: { ...armed, lastDispatchedOccurrenceAt: '2026-09-20T09:00:00.000Z' },
        }),
      ]);
      mocks.swapDispatchedScheduleOccurrence.mockResolvedValue(true);
      mocks.runScheduleTick.mockRejectedValue(new Error('transient'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(await dispatch(false)).toMatchObject({ dispatched: 0, due: 1 });
      expect(mocks.swapDispatchedScheduleOccurrence).toHaveBeenCalledTimes(2);
      // Compare-and-set back to the previous value: only succeeds while the row
      // still holds this reservation, so a newer one is never clobbered.
      expect(mocks.swapDispatchedScheduleOccurrence).toHaveBeenLastCalledWith(
        {},
        'task-1',
        '2026-09-21T09:00:00.000Z',
        '2026-09-20T09:00:00.000Z',
      );
    });
  });
});
