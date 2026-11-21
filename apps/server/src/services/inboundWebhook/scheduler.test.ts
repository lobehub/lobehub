// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleInboundWebhookWake } from './scheduler';

const boundary = vi.hoisted(() => ({ claim: vi.fn(), trigger: vi.fn() }));
vi.mock('@/server/services/redis', () => ({
  redisService: { inboundWebhook: { claimWakeWindow: boundary.claim } },
}));
vi.mock('@/server/workflows/inboundWebhook', () => ({
  InboundWebhookWorkflow: { triggerWake: boundary.trigger },
}));

beforeEach(() => {
  vi.resetAllMocks();
  boundary.trigger.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('inbound webhook wake scheduling', () => {
  it('debounces repeated deliveries into one delayed wake', async () => {
    boundary.claim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await scheduleInboundWebhookWake('webhook');
    await scheduleInboundWebhookWake('webhook');
    expect(boundary.trigger).toHaveBeenCalledExactlyOnceWith({ id: 'webhook' }, 10);
  });

  it('surfaces enqueue failure for the caller while pending signals remain recoverable', async () => {
    const error = new Error('queue unavailable');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    boundary.claim.mockResolvedValue(true);
    boundary.trigger.mockRejectedValue(error);
    await expect(scheduleInboundWebhookWake('webhook', 30)).rejects.toThrow(error);
  });
});
