import { describe, expect, it, vi } from 'vitest';

import { ConnectorDataError } from './errors';
import { withConnectorRetry } from './retry';

const retryOptions = {
  delay: async () => {},
} as const;

describe('withConnectorRetry', () => {
  it('retries a transient 503 and succeeds on the third total attempt', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce('ok');

    await expect(withConnectorRetry(operation, retryOptions)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403, 404])('does not retry status %i', async (status) => {
    const upstreamError = {
      message: 'unsafe upstream response body with token=secret',
      status,
    };
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(upstreamError);

    await expect(withConnectorRetry(operation, retryOptions)).rejects.toBe(upstreamError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it.each([501, 505])('does not retry non-transient server status %i', async (status) => {
    const upstreamError = { status };
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(upstreamError);

    await expect(withConnectorRetry(operation, retryOptions)).rejects.toBe(upstreamError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it.each([500, 502, 503, 504])('retries transient server status %i', async (status) => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ status })
      .mockResolvedValueOnce('ok');

    await expect(withConnectorRetry(operation, retryOptions)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it.each([{ code: 'ETIMEDOUT' }, { status: 503 }])(
    'rethrows the original exhausted transient error',
    async (upstreamError) => {
      const operation = vi.fn<() => Promise<never>>().mockRejectedValue(upstreamError);

      await expect(withConnectorRetry(operation, retryOptions)).rejects.toBe(upstreamError);
      expect(operation).toHaveBeenCalledTimes(3);
    },
  );

  it('preserves a terminal ConnectorDataError', async () => {
    const upstreamError = new ConnectorDataError({
      code: 'github_invalid_request',
      operation: 'getRepository',
      provider: 'github',
      retryable: false,
    });

    await expect(
      withConnectorRetry(async () => {
        throw upstreamError;
      }, retryOptions),
    ).rejects.toBe(upstreamError);
  });

  /** @example expect(error.message).toBe('upstream response status=401'); */
  it('retains an unknown terminal error message', async () => {
    const upstreamMessage = 'upstream response status=401';
    const upstreamError = new Error(upstreamMessage);

    /** @example expect(withConnectorRetry(...)).rejects.toBe(upstreamError); */
    await expect(
      withConnectorRetry(async () => {
        throw upstreamError;
      }, retryOptions),
    ).rejects.toBe(upstreamError);
  });
});
