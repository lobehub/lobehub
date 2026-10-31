import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGoalListAutoLoad } from './useGoalListAutoLoad';

describe('useGoalListAutoLoad', () => {
  const observers: {
    callback: IntersectionObserverCallback;
    disconnect: ReturnType<typeof vi.fn>;
    options?: IntersectionObserverInit;
  }[] = [];
  const observe = vi.fn();

  const intersect = (isIntersecting: boolean) =>
    act(() =>
      observers
        .at(-1)
        ?.callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver),
    );

  beforeEach(() => {
    observers.length = 0;
    observe.mockClear();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        disconnect = vi.fn();
        observe = observe;
        unobserve = vi.fn();

        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          observers.push({ callback, disconnect: this.disconnect, options });
        }
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('reveals more rows once the sentinel nears the viewport', () => {
    const loadMore = vi.fn();
    const { result } = renderHook(() => useGoalListAutoLoad(true, loadMore, 10));
    const sentinel = document.createElement('div');

    act(() => result.current(sentinel));
    expect(observe).toHaveBeenCalledWith(sentinel);

    intersect(false);
    expect(loadMore).not.toHaveBeenCalled();

    intersect(true);
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('measures against the scrolling container so the preload margin applies', () => {
    const { result } = renderHook(() => useGoalListAutoLoad(true, vi.fn(), 10));
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    const list = document.createElement('div');
    const sentinel = document.createElement('div');
    list.append(sentinel);
    scroller.append(list);
    document.body.append(scroller);

    act(() => result.current(sentinel));

    expect(observers.at(-1)?.options?.root).toBe(scroller);
    scroller.remove();
  });

  it('re-observes after each window grows so a reader parked at the bottom keeps loading', () => {
    const loadMore = vi.fn();
    const { result, rerender } = renderHook(
      ({ limit }) => useGoalListAutoLoad(true, loadMore, limit),
      { initialProps: { limit: 10 } },
    );
    act(() => result.current(document.createElement('div')));
    const first = observers.at(-1)!;

    rerender({ limit: 20 });

    expect(first.disconnect).toHaveBeenCalled();
    expect(observers).toHaveLength(2);
    intersect(true);
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('stops observing once every row is visible', () => {
    const loadMore = vi.fn();
    const { result } = renderHook(() => useGoalListAutoLoad(false, loadMore, 30));

    act(() => result.current(document.createElement('div')));
    expect(observe).not.toHaveBeenCalled();
    expect(loadMore).not.toHaveBeenCalled();
  });
});
