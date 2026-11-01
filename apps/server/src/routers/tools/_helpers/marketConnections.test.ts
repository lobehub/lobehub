import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isMarketConnectionsAuthError,
  isMarketConnectionsTimeoutError,
  listMarketConnectionsWithTimeout,
  listOptionalMarketConnectionsWithTimeout,
  MARKET_CONNECTIONS_REQUEST_TIMEOUT_MS,
} from './marketConnections';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('marketConnections helpers', () => {
  it('passes an abort signal to the Market SDK listConnections request', async () => {
    const controller = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const listConnections = vi.fn().mockResolvedValue({ connections: [] });

    await expect(listMarketConnectionsWithTimeout({ listConnections })).resolves.toEqual({
      connections: [],
    });

    expect(timeoutSpy).toHaveBeenCalledWith(MARKET_CONNECTIONS_REQUEST_TIMEOUT_MS);
    expect(listConnections).toHaveBeenCalledWith({ signal: controller.signal });
  });

  it('detects AbortSignal timeout errors', () => {
    expect(isMarketConnectionsTimeoutError(new DOMException('Timed out', 'TimeoutError'))).toBe(
      true,
    );
    expect(isMarketConnectionsTimeoutError(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isMarketConnectionsTimeoutError(new Error('market failed'))).toBe(false);
  });

  it('detects Market auth failures', () => {
    expect(
      isMarketConnectionsAuthError({
        errorBody: { error: 'unauthorized', error_description: 'Missing bearer token' },
        status: 401,
      }),
    ).toBe(true);
    expect(isMarketConnectionsAuthError(new Error('Network error'))).toBe(false);
  });

  it('returns empty connections for optional auth failures', async () => {
    const listConnections = vi.fn().mockRejectedValue({
      errorBody: { error: 'unauthorized', error_description: 'Missing bearer token' },
      status: 401,
    });

    await expect(listOptionalMarketConnectionsWithTimeout({ listConnections })).resolves.toEqual({
      connections: [],
      success: true,
    });
  });

  it('rethrows non-auth failures for optional connections', async () => {
    const error = new Error('Market API unavailable');
    const listConnections = vi.fn().mockRejectedValue(error);

    await expect(listOptionalMarketConnectionsWithTimeout({ listConnections })).rejects.toBe(error);
  });
});
