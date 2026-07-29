import { describe, expect, it, vi } from 'vitest';

import { ConnectorDataError } from './errors';
import { withConnectorRetry } from './retry';

const retryOptions = {
  code: 'github_request_failed',
  delay: async () => {},
  operation: 'listRepositories',
  provider: 'github',
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
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue({
      message: 'unsafe upstream response body with token=secret',
      status,
    });

    await expect(withConnectorRetry(operation, retryOptions)).rejects.toMatchObject({
      code: 'github_request_failed',
      message: 'github listRepositories failed',
      operation: 'listRepositories',
      provider: 'github',
      retryable: false,
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it.each([501, 505])('does not retry non-transient server status %i', async (status) => {
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue({ status });

    await expect(withConnectorRetry(operation, retryOptions)).rejects.toBeInstanceOf(
      ConnectorDataError,
    );
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
    'marks an exhausted transient error as retryable',
    async (upstreamError) => {
      const operation = vi.fn<() => Promise<never>>().mockRejectedValue(upstreamError);

      await expect(withConnectorRetry(operation, retryOptions)).rejects.toMatchObject({
        message: 'github listRepositories failed',
        retryable: true,
      });
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

  it('sanitizes an unknown terminal error', async () => {
    const unsafeMessage = 'upstream response token=secret';

    await expect(
      withConnectorRetry(async () => {
        throw new Error(unsafeMessage);
      }, retryOptions),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'github_request_failed',
        message: 'github listRepositories failed',
        operation: 'listRepositories',
        provider: 'github',
        retryable: false,
      }),
    );

    try {
      await withConnectorRetry(async () => {
        throw new Error(unsafeMessage);
      }, retryOptions);
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectorDataError);
      expect((error as Error).message).not.toContain(unsafeMessage);
    }
  });
});
