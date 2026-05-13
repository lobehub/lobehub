// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTaskDispatchSchedule } from './bootstrap';

const env = vi.hoisted(() => ({
  APP_URL: 'https://app.example.com',
  INTERNAL_APP_URL: undefined as string | undefined,
  enableQueueAgentRuntime: true,
}));

const create = vi.hoisted(() => vi.fn());

vi.mock('@/envs/app', () => ({
  appEnv: env,
}));

vi.mock('@/libs/qstash', () => ({
  qstashClient: {
    schedules: {
      create,
    },
  },
}));

describe('createTaskDispatchSchedule', () => {
  beforeEach(() => {
    create.mockReset();
    env.APP_URL = 'https://app.example.com';
    env.INTERNAL_APP_URL = undefined;
    env.enableQueueAgentRuntime = true;
  });

  it('creates the 10-minute dispatch schedule with a stable scheduleId', async () => {
    create.mockResolvedValue({ scheduleId: 'task-schedule-dispatch' });

    await createTaskDispatchSchedule();

    expect(create).toHaveBeenCalledWith({
      body: JSON.stringify({}),
      cron: '*/10 * * * *',
      destination: 'https://app.example.com/api/workflows/task/schedule-dispatch',
      headers: {
        'Content-Type': 'application/json',
      },
      label: 'task-schedule-dispatch',
      method: 'POST',
      scheduleId: 'task-schedule-dispatch',
    });
  });

  it('skips schedule creation when task queue runtime is disabled', async () => {
    env.enableQueueAgentRuntime = false;

    await createTaskDispatchSchedule();

    expect(create).not.toHaveBeenCalled();
  });

  it('trims the trailing slash from the app url', async () => {
    create.mockResolvedValue({ scheduleId: 'task-schedule-dispatch' });
    env.APP_URL = 'https://app.example.com/';

    await createTaskDispatchSchedule();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: 'https://app.example.com/api/workflows/task/schedule-dispatch',
      }),
    );
  });
});
