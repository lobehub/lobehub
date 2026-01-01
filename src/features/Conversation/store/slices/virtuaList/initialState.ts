/**
 * Scroll methods exposed by VList, stored as callable functions
 */
export interface VirtuaScrollMethods {
  getScrollOffset: () => number;
  getScrollSize: () => number;
  getViewportSize: () => number;
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
