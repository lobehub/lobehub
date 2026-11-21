import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILTIN_SCHEDULER_JOBS, BuiltinScheduler, type BuiltinSchedulerJob } from './index';

const mocks = vi.hoisted(() => ({
  appEnv: { enableQueueAgentRuntime: false },
  getScheduledTasks: vi.fn(),
  getServerDB: vi.fn(),
  publishJSON: vi.fn(),
  runScheduleTick: vi.fn(),
  swapDispatchedScheduleOccurrence: vi.fn(),
  sweepGoals: vi.fn(),
  sweepInboundWebhooks: vi.fn(),
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
vi.mock('@/server/services/goal/sweep', () => ({ sweepGoals: mocks.sweepGoals }));
vi.mock('@/server/services/inboundWebhook/sweep', () => ({
  sweepInboundWebhooks: mocks.sweepInboundWebhooks,
}));

const dailyNineTask = {
  context: { scheduler: { scheduleStartedAt: '2026-09-21T08:00:00.000Z' } },
  createdByUserId: 'user-1',
  id: 'task-1',
  identifier: 'T-1',
  lastHeartbeatAt: null,
  schedulePattern: '0 9 * * *',
  scheduleTimezone: 'UTC',
};

const job = (id: string, everyMinutes: number, run: BuiltinSchedulerJob['run']) => ({
  everyMinutes,
  id,
  path: `/${id}`,
  run,
});

describe('BuiltinScheduler', () => {
  let scheduler: BuiltinScheduler | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getServerDB.mockResolvedValue({});
    mocks.getScheduledTasks.mockResolvedValue([]);
    mocks.swapDispatchedScheduleOccurrence.mockResolvedValue(true);
    mocks.runScheduleTick.mockResolvedValue({ ran: true, taskIdentifier: 'T-1' });
    mocks.sweepGoals.mockResolvedValue({ advanced: 0, stalled: 0, success: true });
    mocks.sweepInboundWebhooks.mockResolvedValue({ maintained: 0, wakes: 0 });
  });

  afterEach(() => {
    scheduler?.stop();
    scheduler = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('starts a cron task on its minute with no QStash configured', async () => {
    for (const key of ['QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'])
      vi.stubEnv(key, '');
    vi.setSystemTime(new Date('2026-09-21T08:58:30Z'));
    mocks.getScheduledTasks.mockResolvedValue([dailyNineTask]);

    scheduler = new BuiltinScheduler();
    scheduler.start();

    // 08:59 tick: the 09:00 slot is not due yet.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.runScheduleTick).not.toHaveBeenCalled();

    // 09:00 tick: reserved, then run inline — no QStash message involved.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.swapDispatchedScheduleOccurrence).toHaveBeenCalledWith(
      {},
      'task-1',
      null,
      '2026-09-21T09:00:00.000Z',
    );
    expect(mocks.runScheduleTick).toHaveBeenCalledExactlyOnceWith('task-1', 'user-1');
    expect(mocks.publishJSON).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(
      '[builtin-scheduler] lobe-task-schedule-dispatch: total=1 due=1 dispatched=1',
    );
  });

  it('runs every-minute jobs each minute and five-minute jobs on minutes divisible by five', async () => {
    vi.setSystemTime(new Date('2026-09-21T09:02:10Z'));
    const minutely = vi.fn().mockResolvedValue(undefined);
    const fiveMinutely = vi.fn().mockResolvedValue(undefined);

    scheduler = new BuiltinScheduler([job('a', 1, minutely), job('b', 5, fiveMinutely)]);
    scheduler.start();
    // Ticks at 09:03 … 09:10.
    await vi.advanceTimersByTimeAsync(8 * 60_000);

    expect(minutely).toHaveBeenCalledTimes(8);
    // 09:05 and 09:10.
    expect(fiveMinutely).toHaveBeenCalledTimes(2);
  });

  it('skips a job whose previous run has not finished', async () => {
    vi.setSystemTime(new Date('2026-09-21T09:00:30Z'));
    let finish!: () => void;
    const slow = vi.fn(
      () => new Promise<undefined>((resolve) => (finish = () => resolve(undefined))),
    );

    scheduler = new BuiltinScheduler([job('slow', 1, slow)]);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(slow).toHaveBeenCalledTimes(1);

    finish();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it('keeps ticking after a job throws, and logs the failure', async () => {
    vi.setSystemTime(new Date('2026-09-21T09:00:30Z'));
    const failing = vi.fn().mockRejectedValue(new Error('db down'));
    const healthy = vi.fn().mockResolvedValue('did work');

    scheduler = new BuiltinScheduler([job('failing', 1, failing), job('healthy', 1, healthy)]);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2 * 60_000);

    expect(failing).toHaveBeenCalledTimes(2);
    expect(healthy).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      '[builtin-scheduler] failing failed:',
      expect.any(Error),
    );
    expect(console.info).toHaveBeenCalledWith('[builtin-scheduler] healthy: did work');
  });

  it('stays quiet on idle ticks', async () => {
    vi.setSystemTime(new Date('2026-09-21T09:04:30Z'));

    scheduler = new BuiltinScheduler();
    scheduler.start();
    // 09:05: every job runs and finds nothing to do.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.getScheduledTasks).toHaveBeenCalledTimes(1);
    expect(mocks.sweepGoals).toHaveBeenCalledTimes(1);
    expect(mocks.sweepInboundWebhooks).toHaveBeenCalledTimes(1);
    expect(console.info).not.toHaveBeenCalled();
  });

  it('starts only once per process', async () => {
    const { startBuiltinScheduler } = await import('./index');

    const first = startBuiltinScheduler();
    const second = startBuiltinScheduler();

    expect(second).toBe(first);
    expect(console.info).toHaveBeenCalledTimes(1);
    first.stop();
    delete (globalThis as { __lobeBuiltinScheduler?: unknown }).__lobeBuiltinScheduler;
  });
});

describe('BUILTIN_SCHEDULER_JOBS', () => {
  it('covers every QStash schedule the Docker launcher registers', async () => {
    const launcher = await readFile(
      path.join(import.meta.dirname, '../../../../../scripts/serverLauncher/startServer.js'),
      'utf8',
    );
    const block = /const QSTASH_SCHEDULES = \[([\s\S]*?)\n\];/.exec(launcher)?.[1] ?? '';
    const schedules = [...block.matchAll(/id: '([^']+)',\s*path: '([^']+)'/g)].map(
      ([, id, route]) => ({ id, path: route }),
    );

    expect(schedules.length).toBeGreaterThan(0);
    expect(BUILTIN_SCHEDULER_JOBS.map(({ id, path: route }) => ({ id, path: route }))).toEqual(
      schedules,
    );
  });
});
