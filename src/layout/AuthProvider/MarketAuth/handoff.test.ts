import { afterEach, describe, expect, it, vi } from 'vitest';

import { persistMarketAuthResult } from './handoff';

describe('persistMarketAuthResult', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should swallow storage write failures and return false', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(
      persistMarketAuthResult({
        code: 'auth_code',
        state: 'state_value',
        type: 'MARKET_AUTH_SUCCESS',
      }),
    ).toBe(false);

    expect(setItemSpy).toHaveBeenCalledOnce();
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });
});
