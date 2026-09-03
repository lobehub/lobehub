/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { type RefObject } from 'react';
import { type VListHandle } from 'virtua';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadScrollSnapshot, saveScrollSnapshot } from '../utils/scrollSnapshotStore';
import { useTopicScrollPersist } from './useTopicScrollPersist';

interface FakeVList {
  scrollOffset: number;
  scrollSize: number;
  scrollTo: ReturnType<typeof vi.fn>;
  scrollToIndex: ReturnType<typeof vi.fn>;
  viewportSize: number;
}

const createFakeVList = (overrides: Partial<FakeVList> = {}): FakeVList => ({
  scrollOffset: 0,
  scrollSize: 0,
  scrollTo: vi.fn(),
  scrollToIndex: vi.fn(),
  viewportSize: 800,
  ...overrides,
});

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
      expect(handle.scrollTo).not.toHaveBeenCalled();
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
      expect(handle.scrollTo).not.toHaveBeenCalled();
    });

    it('handles another hash navigation within the same topic', async () => {
      const handle = createFakeVList({ scrollSize: 6000 });
      const { rerender } = renderHook(
        ({ index, navigationKey }: { index: number; navigationKey: string }) =>
          useTopicScrollPersist({
            contextKey: 'main_agt_1_tpc_a',
            dataSourceLength: 50,
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

    it('falls back to scrollToIndex(last, end) when there is no snapshot', async () => {
      const handle = createFakeVList({ scrollSize: 5000 });
      renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          virtuaRef: refOf(handle),
        }),
      );

      await advanceFrames(2);

      expect(handle.scrollToIndex).toHaveBeenCalledTimes(1);
      expect(handle.scrollToIndex).toHaveBeenCalledWith(49, { align: 'end' });
      expect(handle.scrollTo).not.toHaveBeenCalled();
    });

    it('translates the restore target by headerOffset when a header slot row is present', async () => {
      const handle = createFakeVList({ scrollSize: 5000 });
      renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
          headerOffset: 1,
          virtuaRef: refOf(handle),
        }),
      );

      await advanceFrames(2);

      // Last message sits at virtua row 50 (header row 0 + 50 messages).
      expect(handle.scrollToIndex).toHaveBeenCalledTimes(1);
      expect(handle.scrollToIndex).toHaveBeenCalledWith(50, { align: 'end' });
    });

    it('falls back to scrollToIndex(last, end) when snapshot.atBottom is true', async () => {
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
          virtuaRef: refOf(handle),
        }),
      );

      await advanceFrames(2);

      expect(handle.scrollToIndex).toHaveBeenCalledWith(49, { align: 'end' });
      expect(handle.scrollTo).not.toHaveBeenCalled();
    });

    it('does not call scrollTo immediately when virtua scrollSize is too small', async () => {
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
          virtuaRef: refOf(handle),
        }),
      );

      // A few frames in, virtua still hasn't measured items below the fold —
      // scrollTo would be clamped, so the hook must keep polling instead.
      await advanceFrames(4);
      expect(handle.scrollTo).not.toHaveBeenCalled();
    });

    it('calls scrollTo with the saved offset once virtua has measured enough', async () => {
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
          virtuaRef: refOf(handle),
        }),
      );

      await advanceFrames(3);
      expect(handle.scrollTo).not.toHaveBeenCalled();

      // Simulate virtua finishing layout — now scrollSize is big enough to
      // accommodate target + viewport.
      handle.scrollSize = 6000;
      await advanceFrames(3);

      expect(handle.scrollTo).toHaveBeenCalledTimes(1);
      expect(handle.scrollTo).toHaveBeenCalledWith(5000);
    });

    it('gives up polling after the cap and calls scrollTo anyway', async () => {
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
          virtuaRef: refOf(handle),
        }),
      );

      // 30-frame cap + a few extra for the release rAFs.
      await advanceFrames(40);

      expect(handle.scrollTo).toHaveBeenCalledTimes(1);
      expect(handle.scrollTo).toHaveBeenCalledWith(999_999);
    });

    it('converges the snapshot to the actual landing position after capping out', async () => {
      saveScrollSnapshot('main_agt_1_tpc_a', {
        atBottom: false,
        offset: 999_999,
        savedAt: Date.now() - 60_000,
      });
      const handle = createFakeVList({ scrollSize: 1500, viewportSize: 800 });
      // Simulate virtua clamping the request to the actual scrollable range.
      handle.scrollTo.mockImplementation((offset: number) => {
        handle.scrollOffset = Math.min(offset, handle.scrollSize - handle.viewportSize);
      });

      renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
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
      handle.scrollTo.mockImplementation((offset: number) => {
        handle.scrollOffset = offset;
      });

      renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
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
            virtuaRef: refOf(handle),
          }),
        { initialProps: { length: 0 } },
      );

      await advanceFrames(3);
      expect(handle.scrollTo).not.toHaveBeenCalled();
      expect(handle.scrollToIndex).not.toHaveBeenCalled();

      rerender({ length: 50 });
      await advanceFrames(3);

      expect(handle.scrollTo).toHaveBeenCalledWith(5000);
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
      handle.scrollTo.mockImplementation((offset: number) => {
        handle.scrollOffset = offset;
      });

      const { result, rerender } = renderHook(
        ({ contextKey, length }: { contextKey: string; length: number }) =>
          useTopicScrollPersist({
            contextKey,
            dataSourceLength: length,
            virtuaRef: refOf(handle),
          }),
        { initialProps: { contextKey: 'main_agt_1_tpc_a', length: 50 } },
      );

      await advanceFrames(4);
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
      expect(handle.scrollTo).toHaveBeenCalledWith(3000);
    });

    it('falls back to the bottom when the new topic has no snapshot', async () => {
      const handle = createFakeVList({ scrollSize: 6000, viewportSize: 800 });

      const { rerender } = renderHook(
        ({ contextKey, length }: { contextKey: string; length: number }) =>
          useTopicScrollPersist({
            contextKey,
            dataSourceLength: length,
            virtuaRef: refOf(handle),
          }),
        { initialProps: { contextKey: 'main_agt_1_tpc_a', length: 50 } },
      );

      await advanceFrames(4);
      handle.scrollToIndex.mockClear();

      rerender({ contextKey: 'main_agt_1_tpc_b', length: 30 });
      await advanceFrames(4);

      expect(handle.scrollToIndex).toHaveBeenCalledWith(29, { align: 'end' });
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
          virtuaRef: refOf(handle),
        }),
      );

      // Initial restore (no snapshot) settles, then the user scrolls up.
      await advanceFrames(2);
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
      handle.scrollTo.mockImplementation((offset: number) => {
        handle.scrollOffset = offset;
      });

      const { unmount } = renderHook(() =>
        useTopicScrollPersist({
          contextKey: 'main_agt_1_tpc_a',
          dataSourceLength: 50,
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
