import { describe, expect, it, vi } from 'vitest';

import { isTransientModelError, withTransientRetry } from '../transientRetry';

describe('isTransientModelError', () => {
  it('treats provider outages as transient', () => {
    expect(
      isTransientModelError(new Error('503 The model service is temporarily unavailable.')),
    ).toBe(true);
    expect(isTransientModelError({ errorType: 'ProviderServiceUnavailable', error: {} })).toBe(
      true,
    );
    expect(isTransientModelError({ error: { status: 502 } })).toBe(true);
    expect(
      isTransientModelError({
        error: { error: { message: 'This model is currently experiencing high demand.' } },
      }),
    ).toBe(true);
  });

  it('reads a transient outage nested under a wrapper message', () => {
    // handleOpenAIError keeps the SDK's `Connection error.` and tucks the socket error underneath,
    // so matching only the top-level message drops every reset and timeout on the floor.
    expect(
      isTransientModelError({
        message: 'Connection error.',
        error: new Error('read ECONNRESET'),
      }),
    ).toBe(true);
    expect(
      isTransientModelError({
        error: { message: 'Connection error.', error: { error: { code: 'ETIMEDOUT' } } },
      }),
    ).toBe(true);
    expect(isTransientModelError({ message: 'Connection error.', error: { status: 503 } })).toBe(
      true,
    );
    expect(
      isTransientModelError({
        message: 'Connection error.',
        error: new Error('getaddrinfo ENOTFOUND api.openai.com'),
      }),
    ).toBe(false);
  });

  it('does not retry quota, budget, context or content errors', () => {
    expect(isTransientModelError(new Error('429 You exceeded your current quota'))).toBe(false);
    expect(isTransientModelError({ errorType: 'InsufficientBudgetForModel', error: {} })).toBe(
      false,
    );
    expect(isTransientModelError({ errorType: 'ExceededContextWindow', error: {} })).toBe(false);
    expect(isTransientModelError(new Error('400 request blocked by (PROHIBITED_CONTENT)'))).toBe(
      false,
    );
  });
});

describe('withTransientRetry', () => {
  it('retries a transient failure and returns the later success', async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error('503 temporarily unavailable'))
      .mockResolvedValue('ok');

    await expect(withTransientRetry(call, { delaysMs: [0, 0] })).resolves.toBe('ok');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('gives up after the configured attempts', async () => {
    const call = vi.fn().mockRejectedValue(new Error('503 temporarily unavailable'));

    await expect(withTransientRetry(call, { delaysMs: [0, 0] })).rejects.toThrow('503');
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('fails at once on a non-transient error', async () => {
    const call = vi.fn().mockRejectedValue(new Error('429 You exceeded your current quota'));

    await expect(withTransientRetry(call, { delaysMs: [0, 0] })).rejects.toThrow('429');
    expect(call).toHaveBeenCalledTimes(1);
  });
});
