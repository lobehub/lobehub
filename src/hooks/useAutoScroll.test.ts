/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutoScroll } from './useAutoScroll';

describe('useAutoScroll', () => {
  let rafCallbacks: FrameRequestCallback[] = [];

  beforeEach(() => {
    rafCallbacks = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const flushRAF = () => {
    const callbacks = [...rafCallbacks];
    rafCallbacks = [];
    callbacks.forEach((cb) => cb(performance.now()));
  };

  const createMockContainer = (scrollTop = 0, scrollHeight = 1000, clientHeight = 400) => {
    return {
      clientHeight,
      scrollHeight,
      scrollTop,
    } as HTMLDivElement;
  };

  describe('when enabled changes from true to false (streaming ends)', () => {
    it('should maintain scroll position when streaming ends', () => {
      const { result, rerender } = renderHook(
        ({ content, enabled }) => useAutoScroll<HTMLDivElement>({ deps: [content], enabled }),
        { initialProps: { content: 'initial', enabled: true } },
      );

      // Simulate container scrolled to bottom (scrollTop = scrollHeight - clientHeight = 600)
      const mockContainer = createMockContainer(600, 1000, 400);
      (result.current.ref as { current: HTMLDivElement | null }).current = mockContainer;

      // Trigger auto-scroll with content change while streaming
      rerender({ content: 'updated content', enabled: true });

      act(() => {
        flushRAF();
        flushRAF();
      });

      // Should scroll to bottom (scrollTop = scrollHeight = 1000)
      expect(mockContainer.scrollTop).toBe(mockContainer.scrollHeight);

      // Record scroll position before disabling
      const scrollPositionBeforeDisable = mockContainer.scrollTop;

      // Now simulate streaming end: enabled becomes false
      // This is where the bug occurs - the hook stops maintaining scroll position
      rerender({ content: 'final content', enabled: false });

      act(() => {
        flushRAF();
        flushRAF();
      });

      // BUG TEST: After enabled becomes false, scroll position should be maintained
      // Currently, the hook doesn't actively preserve position when disabled,
      // which can cause scroll to reset when DOM changes occur
      expect(mockContainer.scrollTop).toBe(scrollPositionBeforeDisable);
    });

    it('should actively restore scroll position when DOM resets it after enabled becomes false', () => {
      const { result, rerender } = renderHook(
        ({ content, enabled }) => useAutoScroll<HTMLDivElement>({ deps: [content], enabled }),
        { initialProps: { content: 'initial', enabled: true } },
      );

      const mockContainer = createMockContainer(600, 1000, 400);
      (result.current.ref as { current: HTMLDivElement | null }).current = mockContainer;

      // Auto-scroll to bottom while streaming
      rerender({ content: 'streaming content...', enabled: true });

      act(() => {
        flushRAF();
        flushRAF();
      });

      expect(mockContainer.scrollTop).toBe(1000);

      // Record the scroll position at bottom
      const scrollPositionAtBottom = mockContainer.scrollTop;

      // Streaming ends - enabled becomes false
      rerender({ content: 'final content', enabled: false });

      // Simulate DOM change that resets scroll position to top
      // This happens in real browsers when content re-renders
      mockContainer.scrollTop = 0;

      act(() => {
        flushRAF();
        flushRAF();
      });

      // BUG: The hook should restore scroll position when enabled transitions from true to false
      // Currently it does nothing when enabled=false, so scroll position stays at 0
      // Expected behavior: hook should detect enabled transition and restore position
      expect(mockContainer.scrollTop).toBe(scrollPositionAtBottom);
    });

    it('should preserve scroll position when user has scrolled and streaming ends', () => {
      const { result, rerender } = renderHook(
        ({ content, enabled }) => useAutoScroll<HTMLDivElement>({ deps: [content], enabled }),
        { initialProps: { content: 'initial', enabled: true } },
      );

      // Container at middle position (user scrolled up)
      const mockContainer = createMockContainer(300, 1000, 400);
      (result.current.ref as { current: HTMLDivElement | null }).current = mockContainer;

      // Simulate user scroll (triggers userHasScrolled = true)
      act(() => {
        result.current.handleScroll();
      });

      expect(result.current.userHasScrolled).toBe(true);

      const scrollPositionBeforeDisable = mockContainer.scrollTop;

      // Streaming ends
      rerender({ content: 'final content', enabled: false });

      act(() => {
        flushRAF();
        flushRAF();
      });

      // Position should remain unchanged
      expect(mockContainer.scrollTop).toBe(scrollPositionBeforeDisable);
    });
  });

  describe('basic auto-scroll functionality', () => {
    it('should auto-scroll to bottom when deps change and enabled is true', () => {
      const { result, rerender } = renderHook(
        ({ content }) => useAutoScroll<HTMLDivElement>({ deps: [content], enabled: true }),
        { initialProps: { content: 'initial' } },
      );

      const mockContainer = createMockContainer(0, 1000, 400);
      (result.current.ref as { current: HTMLDivElement | null }).current = mockContainer;

      rerender({ content: 'new content' });

      act(() => {
        flushRAF();
        flushRAF();
      });

      expect(mockContainer.scrollTop).toBe(mockContainer.scrollHeight);
    });

    it('should not auto-scroll when enabled is false', () => {
      const { result, rerender } = renderHook(
        ({ content }) => useAutoScroll<HTMLDivElement>({ deps: [content], enabled: false }),
        { initialProps: { content: 'initial' } },
      );

      const mockContainer = createMockContainer(100, 1000, 400);
      (result.current.ref as { current: HTMLDivElement | null }).current = mockContainer;
      const initialScrollTop = mockContainer.scrollTop;

      rerender({ content: 'new content' });

      act(() => {
        flushRAF();
        flushRAF();
      });

      expect(mockContainer.scrollTop).toBe(initialScrollTop);
    });

    it('should stop auto-scroll when user scrolls away from bottom', () => {
      const { result, rerender } = renderHook(
        ({ content }) =>
          useAutoScroll<HTMLDivElement>({ deps: [content], enabled: true, threshold: 20 }),
        { initialProps: { content: 'initial' } },
      );

      // Container NOT at bottom (distance to bottom > threshold)
      const mockContainer = createMockContainer(100, 1000, 400);
      (result.current.ref as { current: HTMLDivElement | null }).current = mockContainer;

      // Simulate user scroll event
      act(() => {
        result.current.handleScroll();
      });

      expect(result.current.userHasScrolled).toBe(true);

      // Content changes but should not auto-scroll due to user scroll lock
      const scrollTopBeforeUpdate = mockContainer.scrollTop;
      rerender({ content: 'new content' });

      act(() => {
        flushRAF();
        flushRAF();
      });

      expect(mockContainer.scrollTop).toBe(scrollTopBeforeUpdate);
    });

    it('should reset scroll lock when resetScrollLock is called', () => {
      const { result, rerender } = renderHook(
        ({ content }) => useAutoScroll<HTMLDivElement>({ deps: [content], enabled: true }),
        { initialProps: { content: 'initial' } },
      );

      const mockContainer = createMockContainer(100, 1000, 400);
      (result.current.ref as { current: HTMLDivElement | null }).current = mockContainer;

      // User scrolls away
      act(() => {
        result.current.handleScroll();
      });

      expect(result.current.userHasScrolled).toBe(true);

      // Reset scroll lock
      act(() => {
        result.current.resetScrollLock();
      });

      expect(result.current.userHasScrolled).toBe(false);

      // Now auto-scroll should work again
      rerender({ content: 'new content' });

      act(() => {
        flushRAF();
        flushRAF();
      });

      expect(mockContainer.scrollTop).toBe(mockContainer.scrollHeight);
    });
  });

  describe('threshold behavior', () => {
    it('should not set userHasScrolled when at bottom within threshold', () => {
      const { result } = renderHook(() =>
        useAutoScroll<HTMLDivElement>({ deps: [], enabled: true, threshold: 20 }),
      );

      // Container at bottom (distance = scrollHeight - scrollTop - clientHeight = 1000 - 590 - 400 = 10 < 20)
      const mockContainer = createMockContainer(590, 1000, 400);
      (result.current.ref as { current: HTMLDivElement | null }).current = mockContainer;

      act(() => {
        result.current.handleScroll();
      });

      // Should NOT set userHasScrolled because we're within threshold
      expect(result.current.userHasScrolled).toBe(false);
    });

    it('should set userHasScrolled when scrolled beyond threshold', () => {
      const { result } = renderHook(() =>
        useAutoScroll<HTMLDivElement>({ deps: [], enabled: true, threshold: 20 }),
      );

      // Container NOT at bottom (distance = 1000 - 500 - 400 = 100 > 20)
      const mockContainer = createMockContainer(500, 1000, 400);
      (result.current.ref as { current: HTMLDivElement | null }).current = mockContainer;

      act(() => {
        result.current.handleScroll();
      });

      expect(result.current.userHasScrolled).toBe(true);
    });
  });
});
