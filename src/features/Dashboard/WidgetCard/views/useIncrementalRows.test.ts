import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ROW_BATCH, useIncrementalRows } from './useIncrementalRows';

let trigger: () => void;

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        trigger = () =>
          callback([{ isIntersecting: true } as IntersectionObserverEntry], this as never);
      }
      disconnect() {}
      observe() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useIncrementalRows', () => {
  it('shows every row when not incremental', () => {
    const { result } = renderHook(() => useIncrementalRows(100, false));
    expect(result.current.count).toBe(100);
    expect(result.current.hasMore).toBe(false);
  });

  it('starts with one batch and reveals the next when the sentinel scrolls into view', () => {
    const { result } = renderHook(() => useIncrementalRows(100, true));
    expect(result.current.count).toBe(ROW_BATCH);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.sentinelRef(document.createElement('div')));
    act(() => trigger());
    expect(result.current.count).toBe(ROW_BATCH * 2);
  });

  it('never reveals more rows than exist', () => {
    const { result } = renderHook(() => useIncrementalRows(25, true));
    act(() => result.current.sentinelRef(document.createElement('div')));
    act(() => trigger());
    expect(result.current.count).toBe(25);
    expect(result.current.hasMore).toBe(false);
  });
});
