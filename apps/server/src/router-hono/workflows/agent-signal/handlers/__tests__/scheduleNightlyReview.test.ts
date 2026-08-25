import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleNightlyReview } from '../scheduleNightlyReview';

const mocks = vi.hoisted(() => ({
  publishPaginateUsersEntry: vi.fn(),
}));

vi.mock('@/server/workflows/agentSignal/nightlyReview', () => ({
  AgentSignalNightlyReviewWorkflow: {
    publishPaginateUsersEntry: mocks.publishPaginateUsersEntry,
  },
}));

const createApp = () => {
  const app = new Hono();

  app.post('/cron-hourly-nightly-self-review', scheduleNightlyReview);

  return app;
};

describe('scheduleNightlyReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-03T18:30:00.000Z'));
    mocks.publishPaginateUsersEntry.mockResolvedValue({ messageId: 'nightly-message-1' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses bounded defaults when QStash sends an empty body', async () => {
    /**
     * @example
     * expect(response.status).toBe(202);
     */
    const response = await createApp().request('/cron-hourly-nightly-self-review', {
      method: 'POST',
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      scheduled: true,
      success: true,
      messageId: 'nightly-message-1',
    });
    expect(mocks.publishPaginateUsersEntry).toHaveBeenCalledWith({
      cursor: undefined,
      pageSize: 50,
      requestedAt: '2026-05-03T18:30:00.000Z',
      targetLimit: 20,
      whitelist: undefined,
    });
  });

  it('forwards valid scheduler options from the request body', async () => {
    /**
     * @example
     * expect(triggerPaginateUsers).toHaveBeenCalledWith(options);
     */
    const response = await createApp().request('/cron-hourly-nightly-self-review', {
      body: JSON.stringify({
        cursor: { createdAt: '2026-05-04T00:00:00.000Z', id: 'user-1' },
        limit: 100,
        targetLimit: 5,
        whitelist: ['user-1', ''],
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      scheduled: true,
      success: true,
      messageId: 'nightly-message-1',
    });
    expect(mocks.publishPaginateUsersEntry).toHaveBeenCalledWith({
      cursor: { createdAt: '2026-05-04T00:00:00.000Z', id: 'user-1' },
      pageSize: 100,
      requestedAt: '2026-05-03T18:30:00.000Z',
      targetLimit: 5,
      whitelist: ['user-1'],
    });
  });

  it('reports a failed publish as 500 so the error reaches the DLQ', async () => {
    /**
     * Regression: the publish used to stall until Cloudflare returned 524 with an empty body, so
     * every failed tick landed in the DLQ carrying no diagnosis at all.
     *
     * @example
     * expect(response.status).toBe(500);
     */
    mocks.publishPaginateUsersEntry.mockRejectedValue(
      new Error('nightly review cron publish timed out after 10000ms'),
    );

    const response = await createApp().request('/cron-hourly-nightly-self-review', {
      method: 'POST',
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'nightly review cron publish timed out after 10000ms',
    });
  });
});
