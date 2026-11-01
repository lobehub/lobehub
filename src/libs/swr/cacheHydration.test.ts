import { afterEach, describe, expect, it, vi } from 'vitest';

import { cacheHydration, isCacheHydrationBlocked } from './cacheHydration';

describe('cacheHydration', () => {
  const scopes = ['anon:personal', 'u1:personal'];

  afterEach(() => {
    vi.restoreAllMocks();
    scopes.forEach((scope) => cacheHydration.markPending(scope));
  });

  it('marks a ready scope as pending before reload completes', () => {
    const listener = vi.fn();
    const unsubscribe = cacheHydration.subscribe(listener);

    cacheHydration.markReady('anon:personal');
    expect(cacheHydration.isReady('anon:personal')).toBe(true);

    cacheHydration.markPending('anon:personal');

    expect(cacheHydration.isReady('anon:personal')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it('blocks a returned scope until it is released after the latest hydration', () => {
    cacheHydration.markReady('anon:personal');
    cacheHydration.markReady('u1:personal');

    cacheHydration.markPending('anon:personal');

    expect(
      isCacheHydrationBlocked({
        isAuthLoaded: true,
        ready: cacheHydration.isReady('anon:personal'),
        released: false,
        scope: 'anon:personal',
        timedOutScope: null,
      }),
    ).toBe(true);

    cacheHydration.markReady('anon:personal');

    expect(
      isCacheHydrationBlocked({
        isAuthLoaded: true,
        ready: cacheHydration.isReady('anon:personal'),
        released: true,
        scope: 'anon:personal',
        timedOutScope: null,
      }),
    ).toBe(false);
  });

  it('does not let a timeout from another scope release the current scope', () => {
    expect(
      isCacheHydrationBlocked({
        isAuthLoaded: true,
        ready: false,
        released: true,
        scope: 'u1:personal',
        timedOutScope: 'anon:personal',
      }),
    ).toBe(true);

    expect(
      isCacheHydrationBlocked({
        isAuthLoaded: true,
        ready: false,
        released: true,
        scope: 'u1:personal',
        timedOutScope: 'u1:personal',
      }),
    ).toBe(false);
  });
});
