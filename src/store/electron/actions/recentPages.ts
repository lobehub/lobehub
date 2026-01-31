import { type StateCreator } from 'zustand/vanilla';

import {
  getPinnedPages,
  savePinnedPages,
} from '@/features/Electron/titlebar/RecentlyViewed/storage';
import {
  type CachedPageData,
  type PageReference,
} from '@/features/Electron/titlebar/RecentlyViewed/types';

import type { ElectronStore } from '../store';

// ======== Constants ======== //

const RECENT_PAGES_LIMIT = 20;
const PINNED_PAGES_LIMIT = 10;

// ======== Types ======== //

export interface RecentPagesState {
  pinnedPages: PageReference[];
  recentPages: PageReference[];
}

// ======== Action Interface ======== //

export interface RecentPagesAction {
  /**
   * Add/update a page reference in recent list (auto-dedupe)
   * @param reference - The page reference to add
   * @param cached - Optional cached display data (title, avatar, etc.)
   */
  addRecentPage: (reference: PageReference, cached?: CachedPageData) => void;

  /**
   * Clear all recent pages
   */
  clearRecentPages: () => void;

  /**
   * Check if a page is pinned by its ID
   */
  isPagePinned: (id: string) => boolean;

  /**
   * Load pinned pages from localStorage (called on init)
   */
  loadPinnedPages: () => void;

  /**
   * Add a page to pinned list
   */
  pinPage: (reference: PageReference) => void;

  /**
   * Remove a page from recent list by ID
   */
  removeRecentPage: (id: string) => void;

  /**
   * Remove a page from pinned list by ID
   */
  unpinPage: (id: string) => void;
}

// ======== Initial State ======== //

export const recentPagesInitialState: RecentPagesState = {
  pinnedPages: [],
  recentPages: [],
};

// ======== Action Implementation ======== //

export const createRecentPagesSlice: StateCreator<
  ElectronStore,
  [['zustand/devtools', never]],
  [],
  RecentPagesAction
> = (set, get) => ({
  addRecentPage: (reference, cached) => {
    const { pinnedPages, recentPages } = get();
    const { id } = reference;

    // If pinned, update cached data on pinned entry
    const pinnedIndex = pinnedPages.findIndex((p) => p.id === id);
    if (pinnedIndex >= 0) {
      if (cached) {
        const updatedPinned = [...pinnedPages];
        updatedPinned[pinnedIndex] = {
          ...updatedPinned[pinnedIndex],
          cached: { ...updatedPinned[pinnedIndex].cached, ...cached },
        };
        set({ pinnedPages: updatedPinned }, false, 'updatePinnedPageCache');
        savePinnedPages(updatedPinned);
      }
      return;
    }

    // Find existing entry
    const existingIndex = recentPages.findIndex((p) => p.id === id);
    const existingEntry = existingIndex >= 0 ? recentPages[existingIndex] : null;

    // Merge cached data: new cached takes precedence, but preserve existing fields if not provided
    const mergedCached = cached ? { ...existingEntry?.cached, ...cached } : existingEntry?.cached;

    const newEntry: PageReference = {
      ...reference,
      cached: mergedCached,
      lastVisited: Date.now(),
      visitCount: (existingEntry?.visitCount || 0) + 1,
    };

    // Remove existing if present
    const filtered =
      existingIndex >= 0 ? recentPages.filter((_, i) => i !== existingIndex) : recentPages;

    // Add to front, enforce limit
    const newRecent = [newEntry, ...filtered].slice(0, RECENT_PAGES_LIMIT);

    set({ recentPages: newRecent }, false, 'addRecentPage');
  },

  clearRecentPages: () => {
    set({ recentPages: [] }, false, 'clearRecentPages');
  },

  isPagePinned: (id) => {
    return get().pinnedPages.some((p) => p.id === id);
  },

  loadPinnedPages: () => {
    const pinned = getPinnedPages();
    const { recentPages } = get();

    const pinnedIds = new Set(pinned.map((p) => p.id));

    // Filter out any pages from recent that are now in pinned
    // This handles the race condition where addRecentPage runs before loadPinnedPages
    const filteredRecent = recentPages.filter((p) => !pinnedIds.has(p.id));

    set({ pinnedPages: pinned, recentPages: filteredRecent }, false, 'loadPinnedPages');
  },

  pinPage: (reference) => {
    const { pinnedPages, recentPages } = get();
    const { id } = reference;

    // Check if already pinned
    if (pinnedPages.some((p) => p.id === id)) return;

    // Check if pinned list is full
    if (pinnedPages.length >= PINNED_PAGES_LIMIT) return;

    // Find existing entry in recent to preserve cached data
    const existingRecent = recentPages.find((p) => p.id === id);

    const newEntry: PageReference = {
      ...reference,
      // Preserve cached data from recent page if available
      cached: reference.cached ?? existingRecent?.cached,
      lastVisited: Date.now(),
    };

    // Add to pinned, remove from recent if exists
    const newPinned = [...pinnedPages, newEntry];
    const newRecent = recentPages.filter((p) => p.id !== id);

    set({ pinnedPages: newPinned, recentPages: newRecent }, false, 'pinPage');
    savePinnedPages(newPinned);
  },

  removeRecentPage: (id) => {
    const { recentPages } = get();
    set({ recentPages: recentPages.filter((p) => p.id !== id) }, false, 'removeRecentPage');
  },

  unpinPage: (id) => {
    const { pinnedPages, recentPages } = get();
    const page = pinnedPages.find((p) => p.id === id);

    if (!page) return;

    const newPinned = pinnedPages.filter((p) => p.id !== id);

    // Add back to recent (at the front)
    const newRecent = [page, ...recentPages].slice(0, RECENT_PAGES_LIMIT);

    set({ pinnedPages: newPinned, recentPages: newRecent }, false, 'unpinPage');
    savePinnedPages(newPinned);
  },
});
