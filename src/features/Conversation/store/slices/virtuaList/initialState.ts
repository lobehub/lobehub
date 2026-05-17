/**
 * Scroll methods exposed by VList, stored as callable functions
 */
export interface VirtuaScrollMethods {
  getItemOffset: (index: number) => number;
  getItemSize: (index: number) => number;
  getScrollOffset: () => number;
  getScrollSize: () => number;
  /**
   * Total number of items currently rendered by VList, including trailing
   * synthetic items (spacer, footerSlot) that are not part of displayMessages.
   * Used by scrollToBottom to land on the true last index instead of the last
   * message, which would otherwise leave trailing items below the viewport.
   */
  getTotalCount: () => number;
  getViewportSize: () => number;
  scrollTo: (offset: number) => void;
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
  isScrolling: false,
  virtuaScrollMethods: null,
  visibleItems: new Map(),
};
