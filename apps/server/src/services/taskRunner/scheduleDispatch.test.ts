import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchScheduledTasks } from './scheduleDispatch';

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

const dailyNineTasks = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    context: { scheduler: { scheduleStartedAt: '2026-09-21T08:00:00.000Z' } },
    createdByUserId: `user-${i}`,
    id: `task-${i}`,
    identifier: `T-${i}`,
    lastHeartbeatAt: null,
    schedulePattern: '0 9 * * *',
    scheduleTimezone: 'UTC',
  }));

describe('dispatchScheduledTasks', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-21T09:00:30Z'));
    mocks.getServerDB.mockResolvedValue({});
    mocks.swapDispatchedScheduleOccurrence.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('starts at most five inline ticks at once when a busy minute has many due tasks', async () => {
    mocks.getScheduledTasks.mockResolvedValue(dailyNineTasks(12));
    let inFlight = 0;
    let peak = 0;
    mocks.runScheduleTick.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { ran: true, taskIdentifier: 'T' };
    });

    const result = await dispatchScheduledTasks();

    expect(result).toMatchObject({ dispatched: 12, due: 12, total: 12 });
    expect(mocks.runScheduleTick).toHaveBeenCalledTimes(12);
    expect(peak).toBe(5);
  });

  it('keeps per-task failure handling: a failed tick releases only its own reservation', async () => {
    mocks.getScheduledTasks.mockResolvedValue(dailyNineTasks(3));
    mocks.runScheduleTick
      .mockResolvedValueOnce({ ran: true, taskIdentifier: 'T-0' })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ ran: true, taskIdentifier: 'T-2' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await dispatchScheduledTasks();

    expect(result).toMatchObject({ dispatched: 2, due: 3 });
    // Three reservations, then one release for the failed tick.
    expect(mocks.swapDispatchedScheduleOccurrence).toHaveBeenCalledTimes(4);
    expect(mocks.swapDispatchedScheduleOccurrence).toHaveBeenLastCalledWith(
      {},
      'task-1',
      '2026-09-21T09:00:00.000Z',
      null,
    );
  });
});
