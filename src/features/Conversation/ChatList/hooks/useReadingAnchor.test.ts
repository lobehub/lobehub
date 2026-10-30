/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { type RefObject } from 'react';
import { type VListHandle } from 'virtua';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadReadingAnchor, saveReadingAnchor } from '../utils/readingAnchorStore';
import { useReadingAnchor } from './useReadingAnchor';

const KEY = 'main_agt_1_tpc_share';
const ROW_HEIGHT = 100;
const HEADER_OFFSET = 1;

const createHandle = () => {
  const handle = {
    findItemIndex: vi.fn((offset: number) => Math.floor(offset / ROW_HEIGHT)),
    getItemOffset: vi.fn((index: number) => index * ROW_HEIGHT),
    scrollOffset: 0,
    scrollToIndex: vi.fn(),
  };
  return {
    handle,
    ref: { current: handle as unknown as VListHandle } as RefObject<VListHandle | null>,
  };
};

const createScroller = () => {
  const target = new EventTarget();
  return target as unknown as HTMLElement;
};

const ids = (count: number) => Array.from({ length: count }, (_, i) => `msg_${i}`);

const renderAnchor = (initial: { dataSource: string[]; enabled?: boolean }) => {
  const { handle, ref } = createHandle();
  const scroller = createScroller();
  const loadPage = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(
    ({ dataSource, enabled }: { dataSource: string[]; enabled: boolean }) =>
      useReadingAnchor({
        contextKey: KEY,
        dataSource,
        enabled,
        getScroller: () => scroller,
        headerOffset: HEADER_OFFSET,
        loadPage,
        virtuaRef: ref,
      }),
    { initialProps: { dataSource: initial.dataSource, enabled: initial.enabled ?? true } },
  );
  return { ...hook, handle, loadPage, scroller };
};

describe('useReadingAnchor', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records the message at the top of the viewport and its offset within it', () => {
    const { handle, result, unmount } = renderAnchor({ dataSource: ids(10) });

    // Row 4 is msg_3; the viewport top sits 30px into it.
    handle.scrollOffset = 430;
    act(() => result.current.onScroll(true));
    unmount();

    expect(loadReadingAnchor(KEY)).toMatchObject({ messageId: 'msg_3', offset: 30 });
  });

  it('clears the anchor once the reader is back at the header', () => {
    saveReadingAnchor(KEY, { messageId: 'msg_3', offset: 0, savedAt: Date.now() });
    const { handle, result, unmount } = renderAnchor({ dataSource: ids(10) });

    handle.scrollOffset = 20;
    act(() => result.current.onScroll(true));
    unmount();

    expect(loadReadingAnchor(KEY)).toBeNull();
  });

  it('restores a saved anchor that is already loaded', async () => {
    saveReadingAnchor(KEY, { messageId: 'msg_3', offset: 30, savedAt: Date.now() });
    const { handle, loadPage } = renderAnchor({ dataSource: ids(10) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(loadPage).not.toHaveBeenCalled();
    expect(handle.scrollToIndex).toHaveBeenCalledWith(3 + HEADER_OFFSET, {
      align: 'start',
      offset: 30,
    });
  });

  it('pages in later rows until the anchor is loaded, then scrolls to it', async () => {
    saveReadingAnchor(KEY, { messageId: 'msg_25', offset: 0, savedAt: Date.now() });
    const { handle, loadPage, rerender } = renderAnchor({ dataSource: ids(10) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(handle.scrollToIndex).not.toHaveBeenCalled();

    rerender({ dataSource: ids(20), enabled: true });
    expect(loadPage).toHaveBeenCalledTimes(2);

    rerender({ dataSource: ids(30), enabled: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(handle.scrollToIndex).toHaveBeenCalledWith(25 + HEADER_OFFSET, {
      align: 'start',
      offset: 0,
    });
  });

  it('stops paging once a page adds nothing', async () => {
    saveReadingAnchor(KEY, { messageId: 'msg_deleted', offset: 0, savedAt: Date.now() });
    const { loadPage, rerender } = renderAnchor({ dataSource: ids(10) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    rerender({ dataSource: ids(10), enabled: true });

    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it('abandons the restore when the reader scrolls first', async () => {
    saveReadingAnchor(KEY, { messageId: 'msg_25', offset: 0, savedAt: Date.now() });
    const { handle, rerender, result } = renderAnchor({ dataSource: ids(10) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    handle.scrollOffset = 250;
    act(() => result.current.onScroll(true));
    rerender({ dataSource: ids(30), enabled: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(handle.scrollToIndex).not.toHaveBeenCalled();
  });

  it('abandons the restore on input that does not scroll while pages load', async () => {
    saveReadingAnchor(KEY, { messageId: 'msg_25', offset: 0, savedAt: Date.now() });
    const { handle, rerender, scroller } = renderAnchor({ dataSource: ids(10) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Home at the top or an upward wheel leaves the offset unchanged, so no
    // scroll event reports it.
    act(() => {
      scroller.dispatchEvent(new Event('keydown'));
    });
    rerender({ dataSource: ids(30), enabled: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(handle.scrollToIndex).not.toHaveBeenCalled();
  });

  it('clears the anchor when that input cancels the restore on the header', async () => {
    saveReadingAnchor(KEY, { messageId: 'msg_25', offset: 0, savedAt: Date.now() });
    const { handle, scroller, unmount } = renderAnchor({ dataSource: ids(10) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    handle.scrollOffset = 20;
    act(() => {
      scroller.dispatchEvent(new Event('keydown'));
    });
    unmount();

    expect(loadReadingAnchor(KEY)).toBeNull();
  });

  it('stops re-aiming once the reader takes over', async () => {
    saveReadingAnchor(KEY, { messageId: 'msg_3', offset: 0, savedAt: Date.now() });
    const { handle, scroller } = renderAnchor({ dataSource: ids(10) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsBeforeInput = handle.scrollToIndex.mock.calls.length;
    scroller.dispatchEvent(new Event('wheel'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(handle.scrollToIndex.mock.calls.length).toBeLessThanOrEqual(callsBeforeInput + 1);
  });

  it('neither restores nor records when disabled', async () => {
    saveReadingAnchor(KEY, { messageId: 'msg_3', offset: 0, savedAt: Date.now() });
    const { handle, result, unmount } = renderAnchor({ dataSource: ids(10), enabled: false });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    handle.scrollOffset = 830;
    act(() => result.current.onScroll(true));
    unmount();

    expect(handle.scrollToIndex).not.toHaveBeenCalled();
    expect(loadReadingAnchor(KEY)?.messageId).toBe('msg_3');
  });

  it('records where a smooth or momentum scroll lands after the input ends', () => {
    const { handle, result, unmount } = renderAnchor({ dataSource: ids(10) });

    handle.scrollOffset = 250;
    act(() => result.current.onScroll(true));
    // The tail of the scroll arrives without fresh input.
    handle.scrollOffset = 980;
    act(() => result.current.onScroll(false));
    unmount();

    expect(loadReadingAnchor(KEY)).toMatchObject({ messageId: 'msg_8', offset: 80 });
  });

  it('keeps the saved anchor when a scroll without input fires before the restore', () => {
    saveReadingAnchor(KEY, { messageId: 'msg_25', offset: 0, savedAt: Date.now() });
    const { handle, result, unmount } = renderAnchor({ dataSource: ids(10) });

    handle.scrollOffset = 0;
    act(() => result.current.onScroll(false));
    unmount();

    expect(loadReadingAnchor(KEY)?.messageId).toBe('msg_25');
  });
});
