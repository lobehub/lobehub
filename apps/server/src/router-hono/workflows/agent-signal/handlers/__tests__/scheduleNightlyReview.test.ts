import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleNightlyReview } from '../scheduleNightlyReview';

const mocks = vi.hoisted(() => ({
  dispatchNightlyReviewRequests: vi.fn(),
  getServerDB: vi.fn(),
}));

vi.mock('@/database/server', () => ({
  getServerDB: mocks.getServerDB,
}));

vi.mock('@/server/services/agentSignal/services', () => ({
  createServerNightlyReviewScheduleService: () => ({
    dispatchNightlyReviewRequests: mocks.dispatchNightlyReviewRequests,
  }),
}));

const createApp = () => {
  const app = new Hono();

  app.post('/cron-hourly-nightly-self-review', scheduleNightlyReview);

  return app;
};

describe('scheduleNightlyReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDB.mockResolvedValue({});
    mocks.dispatchNightlyReviewRequests.mockResolvedValue({ enqueued: 2, skipped: 1 });
  });

  it('uses bounded defaults when QStash sends an empty body', async () => {
    /**
     * @example
     * expect(response.status).toBe(200);
     */
    const response = await createApp().request('/cron-hourly-nightly-self-review', {
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({ enqueued: 2, skipped: 1, success: true });
    expect(mocks.dispatchNightlyReviewRequests).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 500,
      targetLimit: 20,
      whitelist: undefined,
    });
  });

  it('forwards valid scheduler options from the request body', async () => {
    /**
     * @example
     * expect(dispatchNightlyReviewRequests).toHaveBeenCalledWith(options);
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

    await expect(response.json()).resolves.toEqual({ enqueued: 2, skipped: 1, success: true });
    expect(mocks.dispatchNightlyReviewRequests).toHaveBeenCalledWith({
      cursor: { createdAt: new Date('2026-05-04T00:00:00.000Z'), id: 'user-1' },
      limit: 100,
      targetLimit: 5,
      whitelist: ['user-1'],
    });
  });
});
