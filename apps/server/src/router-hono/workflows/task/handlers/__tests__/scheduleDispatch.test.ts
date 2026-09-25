import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleDispatch } from '../scheduleDispatch';

const mocks = vi.hoisted(() => ({
  getScheduledTasks: vi.fn(),
  getServerDB: vi.fn(),
}));

vi.mock('@/database/server', () => ({ getServerDB: mocks.getServerDB }));

vi.mock('@/database/models/task', () => ({
  TaskModel: { getScheduledTasks: mocks.getScheduledTasks },
}));

vi.mock('@/libs/qstash', () => ({ qstashClient: { publishJSON: vi.fn() } }));

vi.mock('@/server/services/taskRunner/scheduleTick', () => ({ runScheduleTick: vi.fn() }));

const dryRun = async () => {
  const app = new Hono();
  app.post('/schedule-dispatch', scheduleDispatch);
  const res = await app.request('/schedule-dispatch', {
    body: JSON.stringify({ dryRun: true }),
    method: 'POST',
  });
  return (await res.json()) as { due: number; total: number };
};

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
});
