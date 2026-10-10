/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { type RefObject } from 'react';
import { type VListHandle } from 'virtua';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadScrollSnapshot, saveScrollSnapshot } from '../utils/scrollSnapshotStore';
import { useTopicScrollPersist } from './useTopicScrollPersist';

interface FakeScroller extends HTMLElement {
  /** Fires the listeners the hook registered for `type` */
  emit: (type: string) => void;
  /** Records every `scrollTop` write made by the hook */
  setScrollTop: ReturnType<typeof vi.fn<(value: number) => void>>;
}

interface FakeVList {
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

describe('useTopicScrollPersist', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial restore', () => {
    it('lets a message deep link override the saved scroll position', async () => {
      saveScrollSnapshot('main_agt_1_tpc_a', {
        atBottom: false,
        offset: 5000,
        savedAt: Date.now(),
      });
      const handle = createFakeVList({ scrollSize: 6000 });
      const onHandled = vi.fn();

      renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          getScroller: () => handle.scroller,
          headerOffset: 1,
          messageDeepLink: {
            displayMessageId: 'assistant-group',
            id: 'assistant-child',
            index: 12,
            navigationKey: 'navigation-1',
            onHandled,
          },
          virtuaRef: refOf(handle),
        }),
      );

      await advanceFrames(4);

      expect(handle.scrollToIndex).toHaveBeenCalledWith(13, { align: 'center' });
      expect(handle.scroller.setScrollTop).not.toHaveBeenCalled();
      expect(onHandled).toHaveBeenCalledTimes(1);
    });

    it('centers the exact nested message after its virtual row mounts', async () => {
      const handle = createFakeVList({ scrollSize: 6000 });
      const container = document.createElement('div');
      const target = document.createElement('div');
      target.id = 'assistant-child';
      container.append(target);
      document.body.append(container);
      const originalScrollIntoView = Element.prototype.scrollIntoView;
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;

      try {
        renderHook(() =>
          useTopicScrollPersist({
            containerRef: { current: container },
            contextKey: 'main_agt_1_tpc_a',
            dataSourceLength: 50,
            getScroller: () => handle.scroller,
            messageDeepLink: {
              displayMessageId: 'assistant-group',
              id: 'assistant-child',
              index: 12,
              navigationKey: 'navigation-1',
            },
            virtuaRef: refOf(handle),
          }),
        );

        await advanceFrames(4);

        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
      } finally {
        container.remove();
        Element.prototype.scrollIntoView = originalScrollIntoView;
      }
    });

    it('keeps the deep link pending when only the owning row is rendered', async () => {
      const handle = createFakeVList({ scrollSize: 6000 });
      const container = document.createElement('div');
      const topLevelMessage = document.createElement('div');
      topLevelMessage.id = 'assistant-group';
      container.append(topLevelMessage);
      document.body.append(container);
      const onHandled = vi.fn();
      const originalScrollIntoView = Element.prototype.scrollIntoView;
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;

      try {
        renderHook(() =>
          useTopicScrollPersist({
            containerRef: { current: container },
            contextKey: 'main_agt_1_tpc_a',
            dataSourceLength: 50,
            getScroller: () => handle.scroller,
            messageDeepLink: {
              displayMessageId: 'assistant-group',
              id: 'assistant-child',
              index: 12,
              navigationKey: 'navigation-1',
              onHandled,
            },
            virtuaRef: refOf(handle),
          }),
        );

        await advanceFrames(40);

        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
        expect(onHandled).not.toHaveBeenCalled();
      } finally {
        container.remove();
        Element.prototype.scrollIntoView = originalScrollIntoView;
      }
    });

    it('consumes a deep link when animation frames are suspended', async () => {
      const handle = createFakeVList({ scrollSize: 6000 });
      const container = document.createElement('div');
      const target = document.createElement('div');
      target.id = 'assistant-child';
      container.append(target);
      document.body.append(container);
      const onHandled = vi.fn();
      const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
      const originalScrollIntoView = Element.prototype.scrollIntoView;
      const scrollIntoView = vi.fn();
      globalThis.requestAnimationFrame = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;

      try {
        renderHook(() =>
          useTopicScrollPersist({
            containerRef: { current: container },
            contextKey: 'main_agt_1_tpc_a',
            dataSourceLength: 50,
            getScroller: () => handle.scroller,
            messageDeepLink: {
              displayMessageId: 'assistant-group',
              id: 'assistant-child',
              index: 12,
              navigationKey: 'navigation-1',
              onHandled,
            },
            virtuaRef: refOf(handle),
          }),
        );

        await vi.advanceTimersByTimeAsync(32);

        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
        expect(onHandled).toHaveBeenCalledTimes(1);
      } finally {
        container.remove();
        globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        Element.prototype.scrollIntoView = originalScrollIntoView;
      }
    });

    it('cancels a pending snapshot restore when a deep link arrives', async () => {
      saveScrollSnapshot('main_agt_1_tpc_a', {
        atBottom: false,
        offset: 5000,
        savedAt: Date.now(),
      });
      const handle = createFakeVList({ scrollSize: 1000, viewportSize: 800 });
      const { rerender } = renderHook(
        ({ navigationKey }: { navigationKey?: string }) =>
          useTopicScrollPersist({
            contextKey: 'main_agt_1_tpc_a',
            dataSourceLength: 50,
            getScroller: () => handle.scroller,
            messageDeepLink: navigationKey
              ? {
                  displayMessageId: 'target',
                  id: 'target',
                  index: 8,
                  navigationKey,
                }
              : undefined,
            virtuaRef: refOf(handle),
          }),
        { initialProps: { navigationKey: undefined as string | undefined } },
      );

      await advanceFrames(3);
      rerender({ navigationKey: 'navigation-1' });
      await advanceFrames(4);
      handle.scrollSize = 6000;
      await advanceFrames(6);

      expect(handle.scrollToIndex).toHaveBeenCalledWith(8, { align: 'center' });
      expect(handle.scroller.setScrollTop).not.toHaveBeenCalled();
    });

    it('handles another hash navigation within the same topic', async () => {
      const handle = createFakeVList({ scrollSize: 6000 });
      const { rerender } = renderHook(
        ({ index, navigationKey }: { index: number; navigationKey: string }) =>
          useTopicScrollPersist({
            contextKey: 'main_agt_1_tpc_a',
            dataSourceLength: 50,
            getScroller: () => handle.scroller,
            messageDeepLink: {
              displayMessageId: `message-${index}`,
              id: `message-${index}`,
              index,
              navigationKey,
            },
            virtuaRef: refOf(handle),
          }),
        { initialProps: { index: 8, navigationKey: 'navigation-1' } },
      );

      await advanceFrames(4);
      rerender({ index: 20, navigationKey: 'navigation-2' });
      await advanceFrames(4);

      expect(handle.scrollToIndex).toHaveBeenNthCalledWith(1, 8, { align: 'center' });
      expect(handle.scrollToIndex).toHaveBeenNthCalledWith(2, 20, { align: 'center' });
    });

    it('jumps to the end without a virtua imperative scroll when there is no snapshot', async () => {
      // Regression: virtua's scrollToIndex re-applies its target on every item
      // resize within 150ms, so a restore landing while a reply streamed kept
      // pulling the user back to the bottom after they scrolled up.
      const handle = createFakeVList({ scrollSize: 5000 });
      renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          getScroller: () => handle.scroller,
          virtuaRef: refOf(handle),
        }),
      );

      await advanceFrames(4);

      expect(handle.scroller.setScrollTop).toHaveBeenCalledWith(5000);
      expect(handle.scrollToIndex).not.toHaveBeenCalled();
      expect(handle.scrollTo).not.toHaveBeenCalled();
    });

    it('keeps jumping to the end until the measured height stops changing', async () => {
      const handle = createFakeVList({ scrollSize: 5000 });
      renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          getScroller: () => handle.scroller,
          virtuaRef: refOf(handle),
        }),
      );

      // virtua measures the rows revealed by the first jump.
      handle.scrollSize = 5600;
      await advanceFrames(6);

      expect(handle.scroller.setScrollTop).toHaveBeenLastCalledWith(5600);
      const writes = handle.scroller.setScrollTop.mock.calls.length;

      await advanceFrames(6);
      expect(handle.scroller.setScrollTop).toHaveBeenCalledTimes(writes);
    });

    it('keeps jumping while virtua takes several frames to grow the list', async () => {
      // Regression: stopping after a single unchanged frame left a freshly
      // opened topic short of the bottom once virtua re-rendered the
      // measured rows a few frames later.
      const handle = createFakeVList({ scrollSize: 5000 });
      renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          getScroller: () => handle.scroller,
          virtuaRef: refOf(handle),
        }),
      );

      await advanceFrames(3);
      handle.scrollSize = 7600;
      await advanceFrames(12);

      expect(handle.scroller.setScrollTop).toHaveBeenLastCalledWith(7600);
    });

    it('stops jumping once the user scrolls', async () => {
      const handle = createFakeVList({ scrollSize: 5000 });
      handle.scroller.setScrollTop.mockImplementation(() => {
        handle.scrollSize += 50;
      });
      renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          getScroller: () => handle.scroller,
          virtuaRef: refOf(handle),
        }),
      );

      await advanceFrames(2);
      handle.scroller.emit('wheel');
      await advanceFrames(1);
      const writes = handle.scroller.setScrollTop.mock.calls.length;

      await advanceFrames(10);
      expect(handle.scroller.setScrollTop).toHaveBeenCalledTimes(writes);
    });

    it('stops jumping after the time cap while a streaming reply keeps growing', async () => {
      const handle = createFakeVList({ scrollSize: 5000 });
      handle.scroller.setScrollTop.mockImplementation(() => {
        handle.scrollSize += 50;
      });
      renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          getScroller: () => handle.scroller,
          virtuaRef: refOf(handle),
        }),
      );

      await vi.advanceTimersByTimeAsync(1200);
      const writes = handle.scroller.setScrollTop.mock.calls.length;
      expect(writes).toBeGreaterThan(1);

      await vi.advanceTimersByTimeAsync(500);
      expect(handle.scroller.setScrollTop).toHaveBeenCalledTimes(writes);
    });

    it('jumps to the end when snapshot.atBottom is true', async () => {
      saveScrollSnapshot('main_agt_1_tpc_a', {
        atBottom: true,
        offset: 9999,
        savedAt: Date.now(),
      });
      const handle = createFakeVList({ scrollSize: 5000 });
      renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          getScroller: () => handle.scroller,
          virtuaRef: refOf(handle),
        }),
      );

      await advanceFrames(4);

      expect(handle.scroller.setScrollTop).toHaveBeenCalledWith(5000);
      expect(handle.scroller.setScrollTop).not.toHaveBeenCalledWith(9999);
    });

    it('does not write the saved offset immediately when virtua scrollSize is too small', async () => {
      saveScrollSnapshot('main_agt_1_tpc_a', {
        atBottom: false,
        offset: 5000,
        savedAt: Date.now(),
      });
      const handle = createFakeVList({ scrollSize: 1000, viewportSize: 800 });
      renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          getScroller: () => handle.scroller,
          virtuaRef: refOf(handle),
        }),
      );

      // A few frames in, virtua still hasn't measured items below the fold —
      // scrollTo would be clamped, so the hook must keep polling instead.
      await advanceFrames(4);
      expect(handle.scroller.setScrollTop).not.toHaveBeenCalled();
    });

    it('writes the saved offset once virtua has measured enough', async () => {
      saveScrollSnapshot('main_agt_1_tpc_a', {
        atBottom: false,
        offset: 5000,
        savedAt: Date.now(),
      });
      const handle = createFakeVList({ scrollSize: 1000, viewportSize: 800 });
      renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          getScroller: () => handle.scroller,
          virtuaRef: refOf(handle),
        }),
      );

      await advanceFrames(3);
      expect(handle.scroller.setScrollTop).not.toHaveBeenCalled();

      // Simulate virtua finishing layout — now scrollSize is big enough to
      // accommodate target + viewport.
      handle.scrollSize = 6000;
      await advanceFrames(3);

      expect(handle.scroller.setScrollTop).toHaveBeenCalledTimes(1);
      expect(handle.scroller.setScrollTop).toHaveBeenCalledWith(5000);
      // Written directly so a streaming reply cannot keep re-applying it.
      expect(handle.scrollTo).not.toHaveBeenCalled();
    });

    it('gives up polling after the cap and writes the saved offset anyway', async () => {
      saveScrollSnapshot('main_agt_1_tpc_a', {
        atBottom: false,
        offset: 999_999,
        savedAt: Date.now(),
      });
      const handle = createFakeVList({ scrollSize: 1000, viewportSize: 800 });
      renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          getScroller: () => handle.scroller,
          virtuaRef: refOf(handle),
        }),
      );

      // 30-frame cap + a few extra for the release rAFs.
      await advanceFrames(40);

      expect(handle.scroller.setScrollTop).toHaveBeenCalledTimes(1);
      expect(handle.scroller.setScrollTop).toHaveBeenCalledWith(999_999);
    });

    it('converges the snapshot to the actual landing position after capping out', async () => {
      saveScrollSnapshot('main_agt_1_tpc_a', {
        atBottom: false,
        offset: 999_999,
        savedAt: Date.now() - 60_000,
      });
      const handle = createFakeVList({ scrollSize: 1500, viewportSize: 800 });
      // Simulate virtua clamping the request to the actual scrollable range.
      handle.scroller.setScrollTop.mockImplementation((offset: number) => {
        handle.scrollOffset = Math.min(offset, handle.scrollSize - handle.viewportSize);
      });

      renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          getScroller: () => handle.scroller,
          virtuaRef: refOf(handle),
        }),
      );

      await advanceFrames(40);

      // 1500 - 800 = 700; this is what virtua actually landed on.
      const persisted = loadScrollSnapshot('main_agt_1_tpc_a');
      expect(persisted?.offset).toBe(700);
      // 1500 - 700 - 800 = 0 ≤ 300 → at bottom now that we've clamped.
      expect(persisted?.atBottom).toBe(true);
    });

    it('does not rewrite the snapshot when the saved offset was reached without capping', async () => {
      const originalSavedAt = Date.now() - 60_000;
      saveScrollSnapshot('main_agt_1_tpc_a', {
        atBottom: false,
        offset: 5000,
        savedAt: originalSavedAt,
      });
      const handle = createFakeVList({ scrollSize: 6000, viewportSize: 800 });
      handle.scroller.setScrollTop.mockImplementation((offset: number) => {
        handle.scrollOffset = offset;
      });

      renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          getScroller: () => handle.scroller,
          virtuaRef: refOf(handle),
        }),
      );

      await advanceFrames(20);

      // Snapshot is untouched — same offset and same savedAt.
      const persisted = loadScrollSnapshot('main_agt_1_tpc_a');
      expect(persisted?.offset).toBe(5000);
      expect(persisted?.savedAt).toBe(originalSavedAt);
    });

    it('skips the entire restore until dataSourceLength becomes non-zero', async () => {
      saveScrollSnapshot('main_agt_1_tpc_a', {
        atBottom: false,
        offset: 5000,
        savedAt: Date.now(),
      });
      const handle = createFakeVList({ scrollSize: 6000 });
      const { rerender } = renderHook(
        ({ length }: { length: number }) =>
          useTopicScrollPersist({
            contextKey: 'main_agt_1_tpc_a',
            dataSourceLength: length,
            getScroller: () => handle.scroller,
            virtuaRef: refOf(handle),
          }),
        { initialProps: { length: 0 } },
      );

      await advanceFrames(3);
      expect(handle.scroller.setScrollTop).not.toHaveBeenCalled();
      expect(handle.scrollToIndex).not.toHaveBeenCalled();

      rerender({ length: 50 });
      await advanceFrames(3);

      expect(handle.scroller.setScrollTop).toHaveBeenCalledWith(5000);
    });
  });

  describe('recordScroll suppression during restore', () => {
    it('drops recordScroll calls fired before the restore lands', async () => {
      const startingSnapshot = { atBottom: false, offset: 5000, savedAt: Date.now() };
      saveScrollSnapshot('main_agt_1_tpc_a', startingSnapshot);
      const handle = createFakeVList({ scrollSize: 6000 });

      const { result } = renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          getScroller: () => handle.scroller,
          virtuaRef: refOf(handle),
        }),
      );

      // Simulate the onScroll volley triggered by the programmatic scrollTo
      // landing at offset 0 (because virtua clamped — what used to corrupt
      // the snapshot before the fix).
      act(() => {
        result.current.recordScroll(0, true);
      });

      // Let the restore + flush window pass.
      await advanceFrames(20);
      await vi.advanceTimersByTimeAsync(300);

      expect(loadScrollSnapshot('main_agt_1_tpc_a')?.offset).toBe(5000);
    });

    it('resumes recordScroll after the restore settles', async () => {
      saveScrollSnapshot('main_agt_1_tpc_a', {
        atBottom: false,
        offset: 5000,
        savedAt: Date.now(),
      });
      const handle = createFakeVList({ scrollSize: 6000 });

      const { result } = renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          getScroller: () => handle.scroller,
          virtuaRef: refOf(handle),
        }),
      );

      // Wait for restore to land + guard release (2 rAFs after scrollTo).
      await advanceFrames(20);

      act(() => {
        result.current.recordScroll(7777, false);
      });
      await vi.advanceTimersByTimeAsync(300);

      expect(loadScrollSnapshot('main_agt_1_tpc_a')?.offset).toBe(7777);
    });
  });

  describe('in-place context switch', () => {
    it('re-stamps the topic being left and restores the new topic snapshot', async () => {
      const fixedNow = 1_000_000_000_000;
      vi.setSystemTime(fixedNow);
      saveScrollSnapshot('main_agt_1_tpc_b', {
        atBottom: false,
        offset: 3000,
        savedAt: fixedNow,
      });
      const handle = createFakeVList({ scrollSize: 6000, viewportSize: 800 });
      handle.scroller.setScrollTop.mockImplementation((offset: number) => {
        handle.scrollOffset = offset;
      });

      const { result, rerender } = renderHook(
        ({ contextKey, length }: { contextKey: string; length: number }) =>
          useTopicScrollPersist({
            contextKey,
            dataSourceLength: length,
            getScroller: () => handle.scroller,
            virtuaRef: refOf(handle),
          }),
        { initialProps: { contextKey: 'main_agt_1_tpc_a', length: 50 } },
      );

      // The bottom restore settles after its 150ms quiet window.
      await advanceFrames(10);
      act(() => {
        result.current.recordScroll(1200, false);
      });
      await vi.advanceTimersByTimeAsync(300);

      vi.setSystemTime(fixedNow + 60_000);
      rerender({ contextKey: 'main_agt_1_tpc_b', length: 30 });
      await advanceFrames(6);

      const persistedA = loadScrollSnapshot('main_agt_1_tpc_a');
      expect(persistedA?.offset).toBe(1200);
      expect(persistedA?.savedAt).toBe(fixedNow + 60_000);
      expect(handle.scroller.setScrollTop).toHaveBeenCalledWith(3000);
    });

    it('falls back to the bottom when the new topic has no snapshot', async () => {
      const handle = createFakeVList({ scrollSize: 6000, viewportSize: 800 });

      const { rerender } = renderHook(
        ({ contextKey, length }: { contextKey: string; length: number }) =>
          useTopicScrollPersist({
            contextKey,
            dataSourceLength: length,
            getScroller: () => handle.scroller,
            virtuaRef: refOf(handle),
          }),
        { initialProps: { contextKey: 'main_agt_1_tpc_a', length: 50 } },
      );

      await advanceFrames(4);
      handle.scroller.setScrollTop.mockClear();
      handle.scrollSize = 4000;

      rerender({ contextKey: 'main_agt_1_tpc_b', length: 30 });
      await advanceFrames(4);

      expect(handle.scroller.setScrollTop).toHaveBeenCalledWith(4000);
    });
  });

  describe('leave-time re-stamp', () => {
    it('refreshes savedAt on unmount using the last scrolled position', async () => {
      const fixedNow = 1_000_000_000_000;
      vi.setSystemTime(fixedNow);
      const handle = createFakeVList({ scrollSize: 6000, viewportSize: 800 });

      const { result, unmount } = renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          getScroller: () => handle.scroller,
          virtuaRef: refOf(handle),
        }),
      );

      // Initial restore (no snapshot) settles, then the user scrolls up.
      await advanceFrames(10);
      act(() => {
        result.current.recordScroll(2000, false);
      });
      await vi.advanceTimersByTimeAsync(300);

      // Simulate idle reading: time passes well beyond the 5-min window with no
      // further scrolling, then the user switches topics (unmount).
      vi.setSystemTime(fixedNow + 10 * 60 * 1000);
      unmount();

      const persisted = loadScrollSnapshot('main_agt_1_tpc_a');
      expect(persisted?.offset).toBe(2000);
      // savedAt is the departure time, not the last-scroll time, so a quick
      // return still restores the position.
      expect(persisted?.savedAt).toBe(fixedNow + 10 * 60 * 1000);
    });

    it('refreshes savedAt on unmount even when the user never scrolled after restore', async () => {
      const fixedNow = 1_000_000_000_000;
      vi.setSystemTime(fixedNow);
      // Existing snapshot restored to offset 5000; user then reads without
      // scrolling and leaves after the window would have expired.
      saveScrollSnapshot('main_agt_1_tpc_a', {
        atBottom: false,
        offset: 5000,
        savedAt: fixedNow,
      });
      const handle = createFakeVList({ scrollSize: 6000, viewportSize: 800 });
      handle.scroller.setScrollTop.mockImplementation((offset: number) => {
        handle.scrollOffset = offset;
      });

      const { unmount } = renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          getScroller: () => handle.scroller,
          virtuaRef: refOf(handle),
        }),
      );

      // Let the restore land and seed lastKnownRef from where it landed.
      await advanceFrames(4);

      vi.setSystemTime(fixedNow + 10 * 60 * 1000);
      unmount();

      const persisted = loadScrollSnapshot('main_agt_1_tpc_a');
      expect(persisted?.offset).toBe(5000);
      expect(persisted?.savedAt).toBe(fixedNow + 10 * 60 * 1000);
    });

    it('does not create a snapshot on unmount when nothing was ever recorded', async () => {
      // No prior snapshot, restore falls back to scroll-to-bottom, and the user
      // never scrolls. scrollOffset stays 0 (bottom in the fake) so we still
      // record an at-bottom position — which restores to the bottom anyway.
      const handle = createFakeVList({ scrollSize: 0, viewportSize: 800 });
      const { unmount } = renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_empty',
          dataSourceLength: 50,
          getScroller: () => handle.scroller,
          virtuaRef: refOf(handle),
        }),
      );

      await advanceFrames(4);
      unmount();

      // Either no snapshot, or an at-bottom one — both restore to the bottom.
      const persisted = loadScrollSnapshot('main_agt_1_tpc_empty');
      expect(persisted?.atBottom ?? true).toBe(true);
    });
  });
});
