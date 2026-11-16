// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InboundWebhookWorkflow } from './index';

const mocks = vi.hoisted(() => ({
  appEnv: {
    APP_URL: 'https://lobehub.example.com',
    INTERNAL_APP_URL: undefined as string | undefined,
    enableQueueAgentRuntime: false,
  },
  db: { source: 'test-db' },
  getServerDB: vi.fn(),
  publish: vi.fn(),
  wake: vi.fn(),
}));
vi.mock('@/envs/app', () => ({ appEnv: mocks.appEnv }));
vi.mock('@/libs/qstash', () => ({ qstashClient: { publishJSON: mocks.publish } }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mocks.getServerDB }));
vi.mock('@/server/services/inboundWebhook/waker', () => ({ wakeInboundWebhook: mocks.wake }));

let workflow: typeof InboundWebhookWorkflow;
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.appEnv.enableQueueAgentRuntime = false;
  mocks.appEnv.INTERNAL_APP_URL = undefined;
  mocks.getServerDB.mockResolvedValue(mocks.db);
  mocks.publish.mockResolvedValue({ messageId: 'queued' });
  mocks.wake.mockResolvedValue({ outcome: 'processed' });
  ({ InboundWebhookWorkflow: workflow } = await import('./index'));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('inbound webhook wake scheduler', () => {
  it('publishes a delayed webhook-scoped single-worker job in queue mode', async () => {
    mocks.appEnv.enableQueueAgentRuntime = true;
    expect(await workflow.triggerWake({ id: 'webhook' })).toEqual({ messageId: 'queued' });
    expect(mocks.publish).toHaveBeenCalledWith({
      body: { id: 'webhook' },
      delay: 10,
      flowControl: { key: 'inbound-webhook.wake.webhook', parallelism: 1 },
      retries: 3,
      url: 'https://lobehub.example.com/api/workflows/inbound-webhook/wake',
    });
    expect(mocks.wake).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the internal callback origin and clamps negative queue delays', async () => {
    mocks.appEnv.enableQueueAgentRuntime = true;
    mocks.appEnv.INTERNAL_APP_URL = 'http://internal-lobehub:3010';
    await workflow.triggerWake({ id: 'webhook' }, -2);
    expect(mocks.publish.mock.calls[0][0]).toMatchObject({
      delay: 0,
      url: 'http://internal-lobehub:3010/api/workflows/inbound-webhook/wake',
    });
  });

  it('debounces repeated local deliveries without combining different webhooks', async () => {
    await workflow.triggerWake({ id: 'webhook-a' });
    await workflow.triggerWake({ id: 'webhook-a' });
    await workflow.triggerWake({ id: 'webhook-b' });
    expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(mocks.wake).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.wake.mock.calls).toEqual([
      [mocks.db, 'webhook-a'],
      [mocks.db, 'webhook-b'],
    ]);
    expect(mocks.publish).not.toHaveBeenCalled();

    await workflow.triggerWake({ id: 'webhook-a' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.wake).toHaveBeenCalledTimes(3);
  });

  it('retries a busy topic after 30 seconds, with one outstanding local timer', async () => {
    mocks.wake.mockResolvedValueOnce({ outcome: 'deferred' });
    await workflow.triggerWake({ id: 'busy-webhook' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.wake).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    await workflow.triggerWake({ id: 'busy-webhook' });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(mocks.wake).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.wake).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs local worker failures and frees the debounce slot for the next delivery', async () => {
    const failure = new Error('Database unavailable');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.wake.mockRejectedValueOnce(failure);
    await workflow.triggerWake({ id: 'failed-webhook' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(error).toHaveBeenCalledWith('[inboundWebhook:workflow] Local wake failed', failure);
    expect(vi.getTimerCount()).toBe(0);
    await workflow.triggerWake({ id: 'failed-webhook' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.wake).toHaveBeenCalledTimes(2);
  });
});
