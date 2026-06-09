import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isMarketConnectionsTimeoutError,
  listMarketConnectionsWithTimeout,
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
});
