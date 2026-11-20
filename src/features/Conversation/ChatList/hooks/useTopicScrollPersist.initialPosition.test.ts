/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { type RefObject } from 'react';
import { type VListHandle } from 'virtua';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveScrollSnapshot } from '../utils/scrollSnapshotStore';
import { useTopicScrollPersist } from './useTopicScrollPersist';

const createHandle = (scrollSize: number) => {
  const setScrollTop = vi.fn<(value: number) => void>();
  const scroller = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    scrollHeight: scrollSize,
    set scrollTop(value: number) {
      setScrollTop(value);
    },
  } as unknown as HTMLElement;
  const handle = {
    findItemIndex: (offset: number) => Math.floor(offset / 200),
    getItemOffset: (index: number) => index * 200,
    scrollOffset: 0,
    scrollSize,
    scrollTo: vi.fn(),
    scrollToIndex: vi.fn(),
    viewportSize: 800,
  };
  return {
    handle,
    ref: { current: handle as unknown as VListHandle } as RefObject<VListHandle | null>,
    scroller,
    setScrollTop,
  };
};

const advanceFrames = async (frames: number) => {
  await vi.advanceTimersByTimeAsync(frames * 32);
};

describe('useTopicScrollPersist initialPosition', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens at the first message instead of jumping to the end', async () => {
    const { ref, scroller, setScrollTop } = createHandle(5000);

    renderHook(() =>
      useTopicScrollPersist({
        contextKey: 'main_agt_1_tpc_share',
        dataSource: Array.from({ length: 50 }, (_, index) => `m${index}`),
        getScroller: () => scroller,
        initialPosition: 'top',
        virtuaRef: ref,
      }),
    );
    await advanceFrames(10);

    expect(setScrollTop).toHaveBeenCalledWith(0);
    expect(setScrollTop).not.toHaveBeenCalledWith(5000);
  });

  it('ignores a saved reading position', async () => {
    saveScrollSnapshot('main_agt_1_tpc_share', {
      atBottom: false,
      offset: 1200,
      savedAt: Date.now(),
    });
    const { ref, scroller, setScrollTop } = createHandle(5000);

    renderHook(() =>
      useTopicScrollPersist({
        contextKey: 'main_agt_1_tpc_share',
        dataSource: Array.from({ length: 50 }, (_, index) => `m${index}`),
        getScroller: () => scroller,
        initialPosition: 'top',
        virtuaRef: ref,
      }),
    );
    await advanceFrames(10);

    expect(setScrollTop).not.toHaveBeenCalledWith(1200);
  });

  it('still lets a message deep link choose the position', async () => {
    const { handle, ref, scroller } = createHandle(5000);

    renderHook(() =>
      useTopicScrollPersist({
        contextKey: 'main_agt_1_tpc_share',
        dataSource: Array.from({ length: 50 }, (_, index) => `m${index}`),
        getScroller: () => scroller,
        initialPosition: 'top',
        messageDeepLink: {
          displayMessageId: 'msg-20',
          index: 20,
          messageId: 'msg-20',
          navigationKey: 'nav-1',
        } as any,
        virtuaRef: ref,
      }),
    );
    await advanceFrames(1);

    expect(handle.scrollToIndex).toHaveBeenCalledWith(20, { align: 'center' });
  });
});
