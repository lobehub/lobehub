import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

interface UseAutoScrollOptions {
  /**
   * Dependencies that trigger auto-scroll when changed
   */
  deps?: unknown[];
  /**
   * Whether auto-scroll is enabled (e.g., only when streaming/executing)
   * @default true
   */
  enabled?: boolean;
  /**
   * Distance threshold from bottom to consider "near bottom" (in pixels)
   * @default 20
   */
  threshold?: number;
}

interface UseAutoScrollReturn<T extends HTMLElement> {
  /**
   * Callback to handle scroll events, attach to onScroll
   */
  handleScroll: () => void;
  /**
   * Ref to attach to the scrollable container
   */
  ref: RefObject<T | null>;
  /**
   * Reset the scroll lock state (e.g., when new content starts)
   */
  resetScrollLock: () => void;
  /**
   * Whether user has scrolled away from bottom (scroll lock active)
   */
  userHasScrolled: boolean;
}

/**
 * Hook for auto-scrolling content with user scroll detection
 *
 * Features:
 * - Auto-scrolls to bottom when dependencies change
 * - Detects when user scrolls away from bottom and stops auto-scrolling
 * - Provides reset function for when new content starts
 * - Ignores scroll events triggered by auto-scroll itself
 *
 * @example
 * ```tsx
 * const { ref, handleScroll } = useAutoScroll<HTMLDivElement>({
 *   deps: [content],
 *   enabled: isStreaming,
 * });
 *
 * return (
 *   <ScrollShadow ref={ref} onScroll={handleScroll}>
 *     {content}
 *   </ScrollShadow>
 * );
 * ```
 */
export function useAutoScroll<T extends HTMLElement = HTMLDivElement>(
  options: UseAutoScrollOptions = {},
): UseAutoScrollReturn<T> {
  const { deps = [], enabled = true, threshold = 20 } = options;

  const ref = useRef<T | null>(null);
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const isAutoScrollingRef = useRef(false);

  // Handle user scroll detection
  const handleScroll = useCallback(() => {
    // Ignore scroll events triggered by auto-scroll
    if (isAutoScrollingRef.current) return;

    const container = ref.current;
    if (!container) return;

    // Check if user scrolled away from bottom
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottom = distanceToBottom < threshold;

    // If user scrolled up, stop auto-scrolling
    if (!isAtBottom) {
      setUserHasScrolled(true);
    }
  }, [threshold]);

  // Reset scroll lock state
  const resetScrollLock = useCallback(() => {
    setUserHasScrolled(false);
  }, []);

  // Auto scroll to bottom when deps change (unless user has scrolled or disabled)
  useEffect(() => {
    if (!enabled || userHasScrolled) return;

    const container = ref.current;
    if (!container) return;

    isAutoScrollingRef.current = true;
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
      // Reset the flag after scroll completes
      requestAnimationFrame(() => {
        isAutoScrollingRef.current = false;
      });
    });
  }, [enabled, userHasScrolled, ...deps]);

  return {
    handleScroll,
    ref,
    resetScrollLock,
    userHasScrolled,
  };
}
