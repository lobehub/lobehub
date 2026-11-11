/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { type RefObject } from 'react';
import { type VListHandle } from 'virtua';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTopicScrollPersist } from './useTopicScrollPersist';

const ROW_HEIGHT = 200;
const ROWS = Array.from({ length: 50 }, (_, index) => `m${index}`);

interface FakeScroller extends HTMLElement {
  /** Fires the listeners the hook registered for `type` */
  emit: (type: string) => void;
  /** Records every `scrollTop` write made by the hook */
  setScrollTop: ReturnType<typeof vi.fn<(value: number) => void>>;
}

interface FakeVList {
  findItemIndex: (offset: number) => number;
  getItemOffset: (index: number) => number;
  scroller: FakeScroller;
  scrollOffset: number;
  scrollSize: number;
  scrollTo: ReturnType<typeof vi.fn>;
  scrollToIndex: ReturnType<typeof vi.fn>;
  viewportSize: number;
}

/** Scroll element whose `scrollHeight` mirrors virtua's `scrollSize` */
const createFakeScroller = (handle: FakeVList): FakeScroller => {
  const setScrollTop = vi.fn<(value: number) => void>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener: (type: string, listener: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    emit: (type: string) => {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    },
    get scrollHeight() {
      return handle.scrollSize;
    },
    get scrollTop() {
      return handle.scrollOffset;
    },
    set scrollTop(value: number) {
      setScrollTop(value);
    },
    setScrollTop,
  } as unknown as FakeScroller;
};

const createFakeVList = (overrides: Partial<Omit<FakeVList, 'scroller'>> = {}): FakeVList => {
  const handle = {
    findItemIndex: (offset: number) => Math.max(0, Math.floor(offset / ROW_HEIGHT)),
    getItemOffset: (index: number) => index * ROW_HEIGHT,
    scrollOffset: 0,
    scrollSize: 0,
    scrollTo: vi.fn(),
    scrollToIndex: vi.fn(),
    viewportSize: 800,
    ...overrides,
  } as FakeVList;
  handle.scroller = createFakeScroller(handle);
  return handle;
};

const refOf = (handle: FakeVList | null): RefObject<VListHandle | null> => ({
  current: handle as unknown as VListHandle | null,
});

// One rAF tick in happy-dom is ~16ms; advancing 32ms covers two scheduled
// frames reliably without running all queued timers (which would fire the
// entire poll loop at once).
const advanceFrames = async (frames: number) => {
  await vi.advanceTimersByTimeAsync(frames * 32);
};

describe('useTopicScrollPersist transcript swap', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const KEY = 'main_agt_1_tpc_a';
  const COLLAPSED = ['group', 'user', 'assistant'];

  const renderSwap = (handle: FakeVList, isDetached: () => boolean) =>
    renderHook(
      ({ dataSource }) =>
        useTopicScrollPersist({
          contextKey: KEY,
          dataSource,
          getScroller: () => handle.scroller,
          isDetached,
          virtuaRef: refOf(handle),
        }),
      { initialProps: { dataSource: ROWS } },
    );

  it('returns a following viewport to the bottom when compression folds the history', async () => {
    const handle = createFakeVList({ scrollOffset: 9200, scrollSize: 10_000 });
    const { rerender } = renderSwap(handle, () => false);
    await advanceFrames(20);
    handle.scroller.setScrollTop.mockClear();

    handle.scrollOffset = 0;
    handle.scrollSize = 1400;
    rerender({ dataSource: COLLAPSED });
    await advanceFrames(2);

    expect(handle.scroller.setScrollTop).toHaveBeenCalledWith(1400);
  });

  it('returns to the bottom when a failed compression brings the history back', async () => {
    const handle = createFakeVList({ scrollOffset: 9200, scrollSize: 10_000 });
    const { rerender } = renderSwap(handle, () => false);
    await advanceFrames(20);
    rerender({ dataSource: COLLAPSED });
    await advanceFrames(20);
    handle.scroller.setScrollTop.mockClear();

    handle.scrollOffset = 0;
    rerender({ dataSource: ROWS });
    await advanceFrames(2);

    expect(handle.scroller.setScrollTop).toHaveBeenCalledWith(10_000);
  });

  it('brings a reader back to their row when the history returns, not moving meanwhile', async () => {
    const handle = createFakeVList({ scrollOffset: 9200, scrollSize: 10_000 });
    const { result, rerender } = renderSwap(handle, () => true);
    await advanceFrames(20);
    act(() => result.current.recordScroll(4100, false));
    handle.scroller.setScrollTop.mockClear();

    rerender({ dataSource: COLLAPSED });
    await advanceFrames(20);
    expect(handle.scroller.setScrollTop).not.toHaveBeenCalled();

    // The clamp's scroll event must not replace the position being held.
    act(() => result.current.recordScroll(0, true));
    rerender({ dataSource: ROWS });
    await advanceFrames(4);

    expect(handle.scroller.setScrollTop).toHaveBeenCalledWith(4100);
  });

  it('returns to the bottom when a later compression fails under an older group', async () => {
    const handle = createFakeVList({ scrollOffset: 9200, scrollSize: 10_000 });
    const rows = ['g1', ...ROWS, 'u', 'a'];
    const { rerender } = renderHook(
      ({ dataSource }) =>
        useTopicScrollPersist({
          contextKey: KEY,
          dataSource,
          getScroller: () => handle.scroller,
          isDetached: () => false,
          virtuaRef: refOf(handle),
        }),
      { initialProps: { dataSource: rows } },
    );
    await advanceFrames(20);
    rerender({ dataSource: ['g1', 'g2', 'u', 'a'] });
    await advanceFrames(20);
    handle.scroller.setScrollTop.mockClear();

    handle.scrollOffset = 0;
    rerender({ dataSource: rows });
    await advanceFrames(2);

    expect(handle.scroller.setScrollTop).toHaveBeenCalledWith(10_000);
  });

  it('follows again when the held row never returns and the user has moved on', async () => {
    const handle = createFakeVList({ scrollOffset: 9200, scrollSize: 10_000 });
    let detached = true;
    const { result, rerender } = renderSwap(handle, () => detached);
    await advanceFrames(20);
    act(() => result.current.recordScroll(4100, false));
    rerender({ dataSource: COLLAPSED });
    await advanceFrames(20);
    detached = false;
    handle.scroller.setScrollTop.mockClear();

    handle.scrollSize = 1000;
    rerender({ dataSource: ['group-2', 'user', 'assistant'] });
    await advanceFrames(2);

    expect(handle.scroller.setScrollTop).toHaveBeenCalledWith(1000);
  });

  it('leaves the viewport alone when an older page is prepended', async () => {
    const handle = createFakeVList({ scrollOffset: 9200, scrollSize: 10_000 });
    const { rerender } = renderSwap(handle, () => false);
    await advanceFrames(20);
    handle.scroller.setScrollTop.mockClear();

    rerender({ dataSource: ['older', ...ROWS] });
    await advanceFrames(4);

    expect(handle.scroller.setScrollTop).not.toHaveBeenCalled();
  });
});
