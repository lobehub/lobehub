/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren, useLayoutEffect } from 'react';
import { type Cache, SWRConfig, unstable_serialize } from 'swr';
import { describe, expect, it } from 'vitest';

import { useClientDataSWRWithSync } from './useClientDataSWRWithSync';

const KEY_A = ['test:sync', 'a'] as const;
const KEY_B = ['test:sync', 'b'] as const;
const CACHED_A = [{ id: 'cached-a' }];
const CACHED_B = [{ id: 'cached-b' }];

const createWrapper = () => {
  const cache = new Map([
    [unstable_serialize(KEY_A), { data: CACHED_A }],
    [unstable_serialize(KEY_B), { data: CACHED_B }],
  ]);

  return ({ children }: PropsWithChildren) =>
    createElement(SWRConfig, { value: { provider: () => cache as unknown as Cache } }, children);
};

describe('useClientDataSWRWithSync', () => {
  it('projects hydrated cache before later layout consumers observe the frame', () => {
    let projected: typeof CACHED_A | undefined;
    const layoutObservations: Array<typeof CACHED_A | undefined> = [];

    renderHook(
      () => {
        useClientDataSWRWithSync<{ id: string }[]>(KEY_A, null, {
          onData: (data) => {
            projected = data;
          },
          syncBeforePaint: true,
        });

        useLayoutEffect(() => {
          layoutObservations.push(projected);
        }, []);
      },
      { wrapper: createWrapper() },
    );

    expect(layoutObservations).toEqual([CACHED_A]);
  });

  it('synchronizes each cache key once when the consumer switches keys', () => {
    const synchronizedIds: string[] = [];
    const { rerender } = renderHook(
      ({ cacheKey, revision }: { cacheKey: readonly string[]; revision: number }) => {
        void revision;
        useClientDataSWRWithSync<{ id: string }[]>(cacheKey, null, {
          onData: (data) => {
            synchronizedIds.push(data[0].id);
          },
          syncBeforePaint: true,
        });
      },
      {
        initialProps: { cacheKey: KEY_A as readonly string[], revision: 0 },
        wrapper: createWrapper(),
      },
    );

    rerender({ cacheKey: KEY_A, revision: 1 });
    rerender({ cacheKey: KEY_B, revision: 2 });

    expect(synchronizedIds).toEqual(['cached-a', 'cached-b']);
  });

  it('retries a hydrated snapshot when the destination initially rejects it', () => {
    const attempts: boolean[] = [];
    let projected: typeof CACHED_A | undefined;
    const { rerender } = renderHook(
      ({ ready }: { ready: boolean }) => {
        useClientDataSWRWithSync<{ id: string }[]>(KEY_A, null, {
          onData: (data) => {
            attempts.push(ready);
            if (!ready) return false;

            projected = data;
          },
          syncBeforePaint: true,
        });
      },
      { initialProps: { ready: false }, wrapper: createWrapper() },
    );

    expect(attempts).toEqual([false]);
    expect(projected).toBeUndefined();

    rerender({ ready: true });

    expect(attempts).toEqual([false, true]);
    expect(projected).toBe(CACHED_A);
  });
});
