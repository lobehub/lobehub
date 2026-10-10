/**
 * `useCacheScope` is the entry of a module cycle: it imports `@/store/user`,
 * and the user-store slices import `@/libs/replica`, which imports
 * `useCacheScope` back. Evaluating `useCacheScope` first therefore runs
 * `@/libs/replica`'s body while `useCacheScope`'s exports are still
 * uninitialized — the body must not read them at that point, or every replica
 * resource silently gets a scope with no `get`/`use`/`canPersist`.
 *
 * The import order below is the whole point of the file: the first import has
 * to be `useCacheScope` for the cycle to be entered from that side.
 */
import '@/libs/swr/useCacheScope';

import { describe, expect, it } from 'vitest';

import { cacheScope } from './index';

describe('@/libs/replica cacheScope under the user-store cycle', () => {
  it('is fully wired when useCacheScope is evaluated first', () => {
    expect(typeof cacheScope.canPersist).toBe('function');
    expect(typeof cacheScope.get).toBe('function');
    expect(typeof cacheScope.use).toBe('function');
    expect(typeof cacheScope.get()).toBe('string');
  });
});
