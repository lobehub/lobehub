import { afterEach, describe, expect, it, vi } from 'vitest';

import { isNetworkError } from './networkError';

describe('isNetworkError', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('recognizes a dropped connection even when the browser still reports online', () => {
    vi.stubGlobal('navigator', { onLine: true });

    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(
      true,
    );
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true);
    // tRPC wraps the browser error.
    expect(
      isNetworkError(Object.assign(new Error('Failed to fetch'), { name: 'TRPCClientError' })),
    ).toBe(true);
    expect(
      isNetworkError(new Error('request failed', { cause: new TypeError('Failed to fetch') })),
    ).toBe(true);
  });

  it('treats server and provider errors as not offline', () => {
    vi.stubGlobal('navigator', { onLine: true });

    expect(isNetworkError(new Error('quota_exceeded'))).toBe(false);
    expect(isNetworkError(Object.assign(new Error('Unauthorized'), { status: 401 }))).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });

  it('trusts the browser when it reports offline', () => {
    vi.stubGlobal('navigator', { onLine: false });

    expect(isNetworkError(new Error('anything'))).toBe(true);
  });
});
