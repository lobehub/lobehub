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
});
