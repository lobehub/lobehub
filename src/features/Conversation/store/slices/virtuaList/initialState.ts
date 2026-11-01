/**
 * Scroll methods exposed by VList, stored as callable functions.
 *
 * All index-based methods work in MESSAGE index space: VirtualizedList
 * translates away any leading synthetic row (headerSlot spacer) before
 * hitting virtua, so consumers can pass displayMessages indices directly.
 */
export interface VirtuaScrollMethods {
  getItemOffset: (index: number) => number;
  getItemSize: (index: number) => number;
  /** The VList scroll element, `null` before it mounts */
  getScrollElement: () => HTMLElement | null;
  getScrollOffset: () => number;
  getScrollSize: () => number;
  /**
   * Total number of items currently rendered by VList, including trailing
   * synthetic items (spacer, footerSlot) that are not part of displayMessages
   * but excluding the leading header row (same index space as scrollToIndex).
   * Used by scrollToBottom to land on the true last index instead of the last
   * message, which would otherwise leave trailing items below the viewport.
   */
  getTotalCount: () => number;
  getViewportSize: () => number;
  scrollTo: (offset: number) => void;
  /**
   * One-shot jump to the end by writing the scroller's `scrollTop` directly.
   *
   * Streaming auto-scroll must not use `scrollToIndex`: virtua keeps an
   * imperative scroll alive and re-applies its target on every item resize
   * that lands within 150ms, so while the reply keeps growing it pins the
   * viewport to the bottom and overrides the user's own wheel/touch scroll.
   */
  scrollToEnd: () => void;
  scrollToIndex: (
    index: number,
    options?: { align?: 'start' | 'center' | 'end'; smooth?: boolean },
  ) => void;
}

/**
 * Visible item metrics for active index calculation
 */
export interface VisibleItemMetrics {
  bottom: number;
  ratio: number;
  top: number;
}

export interface VirtuaListState {
  /**
   * Currently active (most visible) message index
   */
  activeIndex: number | null;

  /**
   * Whether the list is at the bottom
   */
  atBottom: boolean;

  /**
   * Whether the user scrolled away from the bottom on purpose. While set,
   * streaming output no longer pulls the viewport down, even when the user is
   * still inside the `atBottom` threshold band. Cleared when the viewport
   * reaches the real bottom again, on send, or on context switch.
   */
  autoScrollDetached: boolean;

  /**
   * Whether the list is currently scrolling
   */
  isScrolling: boolean;

  /**
   * Scroll methods from VList instance
   */
  virtuaScrollMethods: VirtuaScrollMethods | null;

  /**
   * Visible items metrics map (index -> metrics)
   */
  visibleItems: Map<number, VisibleItemMetrics>;
}

export const virtuaListInitialState: VirtuaListState = {
  activeIndex: null,
  atBottom: true,
  autoScrollDetached: false,
  isScrolling: false,
  virtuaScrollMethods: null,
  visibleItems: new Map(),
};
