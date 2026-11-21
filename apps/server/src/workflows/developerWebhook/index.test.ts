// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeveloperWebhookWorkflow } from './index';

const mocks = vi.hoisted(() => ({
  attempt: vi.fn(),
  load: vi.fn(),
  publish: vi.fn(),
  recordAttempt: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/database/models/developerWebhook', () => ({
  WebhookDeliveryWorkerModel: class {
    load = mocks.load;
    recordAttempt = mocks.recordAttempt;
  },
}));
vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com', INTERNAL_APP_URL: '' },
}));
vi.mock('@/libs/qstash', () => ({ qstashClient: { publishJSON: mocks.publish } }));
vi.mock('@/server/services/developerWebhook/deliver', () => ({
  attemptWebhookDelivery: mocks.attempt,
}));

const payload = { deliveryId: 'whd_1', endpointId: 'whk_1' };

/** The model's `load` shape, flattened to what the recovery path reads. */
const row = (overrides: Record<string, unknown> = {}) => ({
  delivery: {
    id: 'whd_1',
    nextAttemptAt: new Date(Date.now() + 30_000),
    status: 'pending',
    ...overrides,
  },
  endpoint: { enabled: true, id: 'whk_1', url: 'https://example.com/hook' },
});

describe('DeveloperWebhookWorkflow.runDeliver', () => {
  beforeEach(() => {
    mocks.attempt.mockReset();
    mocks.load.mockReset();
    mocks.recordAttempt.mockReset();
    mocks.publish.mockReset();
    vi.spyOn(DeveloperWebhookWorkflow, 'triggerDeliver').mockResolvedValue(undefined as never);
  });

  it('schedules the retry the attempt asked for', async () => {
    mocks.attempt.mockResolvedValue({
      delaySeconds: 30,
      delivery: { attempts: 1, status: 'retrying' },
      outcome: 'retry',
    });

    await DeveloperWebhookWorkflow.runDeliver(payload);

    expect(DeveloperWebhookWorkflow.triggerDeliver).toHaveBeenCalledExactlyOnceWith(payload, 30);
  });

  it('schedules a recovery callback when a live lease makes this message a skip', async () => {
    // A handler that died after claiming leaves the next retry `not_due`: this callback is
    // acknowledged, so without a recovery message nothing would ever resume the delivery.
    mocks.attempt.mockResolvedValue({ outcome: 'skipped', reason: 'not_due' });
    mocks.load.mockResolvedValue(row());

    await DeveloperWebhookWorkflow.runDeliver(payload);

    const [, delay] = vi.mocked(DeveloperWebhookWorkflow.triggerDeliver).mock.calls[0];
    expect(delay).toBeGreaterThanOrEqual(29);
    expect(delay).toBeLessThanOrEqual(30);
  });

  it('does not reschedule a settled delivery or one still in a long backoff', async () => {
    mocks.attempt.mockResolvedValue({ outcome: 'skipped', reason: 'not_due' });

    mocks.load.mockResolvedValue(row({ status: 'failed' }));
    await DeveloperWebhookWorkflow.runDeliver(payload);

    // Two hours away is a scheduled retry with its own message, not a claim lease.
    mocks.load.mockResolvedValue(row({ nextAttemptAt: new Date(Date.now() + 2 * 60 * 60 * 1000) }));
    await DeveloperWebhookWorkflow.runDeliver(payload);

    expect(DeveloperWebhookWorkflow.triggerDeliver).not.toHaveBeenCalled();
  });

  it('lets a failed recovery publication surface so the queue can retry it', async () => {
    // The recovery message is the only thing that would resume the delivery; answering 200
    // after failing to publish it would strand the delivery, so the error has to come out.
    mocks.attempt.mockResolvedValue({ outcome: 'skipped', reason: 'not_due' });
    mocks.load.mockResolvedValue(row());
    vi.mocked(DeveloperWebhookWorkflow.triggerDeliver).mockRejectedValueOnce(
      new Error('QStash down'),
    );

    await expect(DeveloperWebhookWorkflow.runDeliver(payload)).rejects.toThrow('QStash down');
  });

  it('leaves a settled skip alone', async () => {
    mocks.attempt.mockResolvedValue({ outcome: 'skipped', reason: 'already_settled' });

    await DeveloperWebhookWorkflow.runDeliver(payload);

    expect(mocks.load).not.toHaveBeenCalled();
    expect(DeveloperWebhookWorkflow.triggerDeliver).not.toHaveBeenCalled();
  });
});
