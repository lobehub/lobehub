import { type StateCreator } from 'zustand';

import { type State } from '../../initialState';
import { type VirtuaScrollMethods, type VisibleItemMetrics } from './initialState';

export interface VirtuaListAction {
  /**
   * Register VList scroll methods
   */
  registerVirtuaScrollMethods: (methods: VirtuaScrollMethods | null) => void;

  /**
   * Remove visible item and recalculate active index
   */
  removeVisibleItem: (index: number) => void;

  /**
   * Reset all visible items (on unmount)
   */
  resetVisibleItems: () => void;

  /**
   * Scroll to bottom of the list
   */
  scrollToBottom: (smooth?: boolean) => void;

  /**
   * Scroll to specific index
   */
  scrollToIndex: (
    index: number,
    options?: { align?: 'start' | 'center' | 'end'; smooth?: boolean },
  ) => void;

  /**
   * Set active index directly (derived from scroll position)
   */
  setActiveIndex: (index: number | null) => void;

  /**
   * Update scroll state (atBottom, isScrolling)
   */
  setScrollState: (state: { atBottom?: boolean; isScrolling?: boolean }) => void;

  /**
   * Upsert visible item metrics and recalculate active index
   */
  upsertVisibleItem: (index: number, metrics: VisibleItemMetrics) => void;
}

/**
 * Recalculate active index based on visible items
 */
const calculateActiveIndex = (visibleItems: Map<number, VisibleItemMetrics>): number | null => {
  if (visibleItems.size === 0) return null;

  let candidate: number | null = null;
  let minTop = Infinity;
  let maxRatio = -Infinity;

  visibleItems.forEach(({ top, ratio }, index) => {
    const shouldUpdate =
      top < minTop ||
      (top === minTop &&
        (ratio > maxRatio || (ratio === maxRatio && index < (candidate ?? Infinity))));

    if (shouldUpdate) {
      candidate = index;
      minTop = top;
      maxRatio = ratio;
    }
  });

  return candidate;
};

export const virtuaListSlice: StateCreator<State & VirtuaListAction, [], [], VirtuaListAction> = (
  set,
  get,
) => ({
  registerVirtuaScrollMethods: (methods) => {
    set({ virtuaScrollMethods: methods });
  },

  removeVisibleItem: (index) => {
    const { visibleItems } = get();
    if (!visibleItems.has(index)) return;

    const newVisibleItems = new Map(visibleItems);
    newVisibleItems.delete(index);

    const activeIndex = calculateActiveIndex(newVisibleItems);
    set({ activeIndex, visibleItems: newVisibleItems });
  },

  resetVisibleItems: () => {
    set({ activeIndex: null, visibleItems: new Map() });
  },

  scrollToBottom: (smooth = true) => {
    const { displayMessages, virtuaScrollMethods } = get();
    if (displayMessages.length === 0) return;

    virtuaScrollMethods?.scrollToIndex(displayMessages.length - 1, {
      align: 'end',
      smooth,
    });
  },

  scrollToIndex: (index, options) => {
    const { virtuaScrollMethods } = get();
    virtuaScrollMethods?.scrollToIndex(index, options);
  },

  setActiveIndex: (index) => {
    set({ activeIndex: index });
  },

  setScrollState: (state) => {
    set(state);
  },

  upsertVisibleItem: (index, metrics) => {
    const { visibleItems } = get();
    const newVisibleItems = new Map(visibleItems);
    newVisibleItems.set(index, metrics);

    const activeIndex = calculateActiveIndex(newVisibleItems);
    set({ activeIndex, visibleItems: newVisibleItems });
  },
});
