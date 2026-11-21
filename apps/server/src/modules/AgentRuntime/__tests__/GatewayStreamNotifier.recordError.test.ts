import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayStreamNotifier } from '../GatewayStreamNotifier';
import { createMockInner } from '../testUtils';
import type { PublishAgentRuntimeEndParams } from '../types';

const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
vi.stubGlobal('fetch', mockFetch);

/** Whether the terminal event tells the gateway to file the error on its board. */
describe('GatewayStreamNotifier recordError', () => {
  let notifier: GatewayStreamNotifier;

  beforeEach(() => {
    mockFetch.mockReset().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    notifier = new GatewayStreamNotifier(
      createMockInner(),
      'https://gateway.test.com',
      'test-token',
    );
  });

  const endEventData = async (
    params: Omit<PublishAgentRuntimeEndParams, 'operationId' | 'stepIndex'>,
  ) => {
    await notifier.publishAgentRuntimeEnd({ operationId: 'op-1', stepIndex: 0, ...params });
    await new Promise((r) => setTimeout(r, 50));
    const pushCall = mockFetch.mock.calls.find((c: any[]) => c[0].includes('push-event'));
    return JSON.parse(pushCall![1].body).event.data;
  };

  it('keeps a user-side error off the gateway board', async () => {
    const data = await endEventData({
      finalState: {
        error: { message: 'insufficient quota', type: 'InsufficientQuota' },
        modelRuntimeConfig: { model: 'gpt-5.6-sol', provider: 'openai' },
      },
      reason: 'error',
    });

    expect(data.recordError).toBe(false);
  });

  it('files a provider rate limit on our own provider', async () => {
    const data = await endEventData({
      finalState: {
        error: { message: '429', type: 'RateLimitExceeded' },
        modelRuntimeConfig: { model: 'claude-opus-5', provider: 'lobehub' },
      },
      reason: 'error',
    });

    expect(data.recordError).toBe(true);
  });

  it('classifies by the configured provider, not the upstream named in the error body', async () => {
    // On our provider the normalized error names the upstream the router
    // reached, never `lobehub` — trusting it would hide our own rate limit.
    const data = await endEventData({
      finalState: {
        error: { body: { provider: 'azure' }, message: '429', type: 'RateLimitExceeded' },
        modelRuntimeConfig: { model: 'gpt-5.6-sol', provider: 'lobehub' },
      },
      reason: 'error',
    });

    expect(data.recordError).toBe(true);
  });

  it('keeps an onboarding-gate refusal off the board', async () => {
    // The numeric Forbidden type has no spec; the normalizer classified it.
    const data = await endEventData({
      finalState: {
        error: {
          attribution: 'user',
          body: { reason: 'not_onboarded' },
          countAsFailure: false,
          message: 'Request blocked.',
          type: 403,
        },
        modelRuntimeConfig: { model: 'deepseek-flash', provider: 'lobehub' },
      },
      reason: 'error',
    });

    expect(data.recordError).toBe(false);
  });

  it('omits the flag on a non-error end', async () => {
    const data = await endEventData({ finalState: {}, reason: 'completed' });

    expect(data).not.toHaveProperty('recordError');
  });
});
