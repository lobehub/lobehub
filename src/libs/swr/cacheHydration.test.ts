import { describe, expect, it, vi } from 'vitest';

import { cacheHydration } from './cacheHydration';
import { buildCacheScope } from './useCacheScope';

describe('cacheHydration', () => {
  it('tracks readiness per scope and notifies subscribers', () => {
    const scope = 'cacheHydration-test-1';
    const listener = vi.fn();
    const unsubscribe = cacheHydration.subscribe(listener);

    expect(cacheHydration.isReady(scope)).toBe(false);

    cacheHydration.markReady(scope);
    expect(cacheHydration.isReady(scope)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    // marking again is a no-op (no extra emit)
    cacheHydration.markReady(scope);
    expect(listener).toHaveBeenCalledTimes(1);

    cacheHydration.reset(scope);
    expect(cacheHydration.isReady(scope)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    cacheHydration.markReady(scope);
    expect(listener).toHaveBeenCalledTimes(2); // unsubscribed
  });
});

describe('buildCacheScope', () => {
  it('falls back to anon/personal', () => {
    expect(buildCacheScope(undefined, undefined)).toBe('anon:personal');
    expect(buildCacheScope(null, null)).toBe('anon:personal');
  });

  it('combines user and workspace', () => {
    expect(buildCacheScope('u1', 'w1')).toBe('u1:w1');
    expect(buildCacheScope('u1', null)).toBe('u1:personal');
  });

  it('isolates different users and workspaces', () => {
    expect(buildCacheScope('u1', 'w1')).not.toBe(buildCacheScope('u2', 'w1'));
    expect(buildCacheScope('u1', 'w1')).not.toBe(buildCacheScope('u1', 'w2'));
  });
});
