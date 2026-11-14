import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearMarketAuthResult,
  persistMarketAuthResult,
  readMarketAuthResult,
  resolveMarketAuthAccountPayload,
} from './handoff';

describe('MarketAuth handoff storage helpers', () => {
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

  it('should swallow storage read failures and return null', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(readMarketAuthResult('state_value')).toBeNull();

    expect(getItemSpy).toHaveBeenCalledOnce();
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });

  it('should swallow storage clear failures and return false', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(clearMarketAuthResult('state_value')).toBe(false);

    expect(removeItemSpy).toHaveBeenCalledOnce();
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });
});

describe('resolveMarketAuthAccountPayload', () => {
  it('should accept a payload carrying the connected account', () => {
    expect(
      resolveMarketAuthAccountPayload({
        account: {
          avatarUrl: 'https://example.com/a.png',
          displayName: 'Innei',
          userName: 'innei',
        },
        state: 'state_value',
        type: 'MARKET_AUTH_ACCOUNT',
      }),
    ).toEqual({
      account: {
        avatarUrl: 'https://example.com/a.png',
        displayName: 'Innei',
        userName: 'innei',
      },
      state: 'state_value',
      type: 'MARKET_AUTH_ACCOUNT',
    });
  });

  it('should reject payloads without a usable account name', () => {
    expect(
      resolveMarketAuthAccountPayload({ account: {}, type: 'MARKET_AUTH_ACCOUNT' }),
    ).toBeNull();
    expect(resolveMarketAuthAccountPayload({ type: 'MARKET_AUTH_SUCCESS' })).toBeNull();
    expect(resolveMarketAuthAccountPayload(null)).toBeNull();
  });
});
