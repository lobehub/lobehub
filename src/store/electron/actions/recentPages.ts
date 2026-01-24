import { type StateCreator } from 'zustand/vanilla';

import {
  getPinnedPages,
  savePinnedPages,
} from '@/features/Electron/titlebar/RecentlyViewed/storage';

import type { ElectronStore } from '../store';

// ======== Constants ======== //

const RECENT_PAGES_LIMIT = 20;
const PINNED_PAGES_LIMIT = 10;

// ======== Helpers ======== //

/**
 * Normalize URL for consistent comparison
 * - Remove trailing slashes
 * - Keep root path as '/'
 */
const normalizeUrl = (url: string): string => {
  return url.replace(/\/+$/, '') || '/';
};

// ======== Types ======== //

export interface PageEntry {
  icon?: string;
  lastVisited: number;
  title: string;
  url: string;
  visitCount?: number;
}

export interface RecentPagesState {
  pinnedPages: PageEntry[];
  recentPages: PageEntry[];
}

// ======== Action Interface ======== //

export interface RecentPagesAction {
  /**
   * Add/update a page in recent list (auto-dedupe)
   */
  addRecentPage: (entry: Omit<PageEntry, 'lastVisited'>) => void;

  /**
   * Clear all recent pages
   */
  clearRecentPages: () => void;

  /**
   * Check if a page is pinned
   */
  isPagePinned: (url: string) => boolean;

  /**
   * Load pinned pages from localStorage (called on init)
   */
  loadPinnedPages: () => void;

  /**
   * Add a page to pinned list
   */
  pinPage: (entry: Omit<PageEntry, 'lastVisited'>) => void;

  /**
   * Remove a page from recent list
   */
  removeRecentPage: (url: string) => void;

  /**
   * Remove a page from pinned list
   */
  unpinPage: (url: string) => void;

  /**
   * Update title for a page (in both recent and pinned lists)
   */
  updateRecentPageTitle: (url: string, title: string) => void;
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
  addRecentPage: (entry) => {
    const { pinnedPages, recentPages } = get();
    const normalizedUrl = normalizeUrl(entry.url);

    // Skip if already pinned
    if (pinnedPages.some((p) => normalizeUrl(p.url) === normalizedUrl)) return;

    // Find existing entry
    const existingIndex = recentPages.findIndex((p) => normalizeUrl(p.url) === normalizedUrl);
    const existingEntry = existingIndex >= 0 ? recentPages[existingIndex] : null;

    const newEntry: PageEntry = {
      icon: entry.icon,
      lastVisited: Date.now(),
      title: entry.title,
      url: normalizedUrl,
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

  isPagePinned: (url) => {
    const normalizedUrl = normalizeUrl(url);
    return get().pinnedPages.some((p) => normalizeUrl(p.url) === normalizedUrl);
  },

  loadPinnedPages: () => {
    const pinned = getPinnedPages();
    set({ pinnedPages: pinned }, false, 'loadPinnedPages');
  },

  pinPage: (entry) => {
    const { pinnedPages, recentPages } = get();
    const normalizedUrl = normalizeUrl(entry.url);

    // Check if already pinned
    if (pinnedPages.some((p) => normalizeUrl(p.url) === normalizedUrl)) return;

    // Check if pinned list is full
    if (pinnedPages.length >= PINNED_PAGES_LIMIT) return;

    const newEntry: PageEntry = {
      icon: entry.icon,
      lastVisited: Date.now(),
      title: entry.title,
      url: normalizedUrl,
      visitCount: entry.visitCount,
    };

    // Add to pinned, remove from recent if exists
    const newPinned = [...pinnedPages, newEntry];
    const newRecent = recentPages.filter((p) => normalizeUrl(p.url) !== normalizedUrl);

    set({ pinnedPages: newPinned, recentPages: newRecent }, false, 'pinPage');
    savePinnedPages(newPinned);
  },

  removeRecentPage: (url) => {
    const normalizedUrl = normalizeUrl(url);
    const { recentPages } = get();
    set(
      { recentPages: recentPages.filter((p) => normalizeUrl(p.url) !== normalizedUrl) },
      false,
      'removeRecentPage',
    );
  },

  unpinPage: (url) => {
    const { pinnedPages, recentPages } = get();
    const normalizedUrl = normalizeUrl(url);
    const page = pinnedPages.find((p) => normalizeUrl(p.url) === normalizedUrl);

    if (!page) return;

    const newPinned = pinnedPages.filter((p) => normalizeUrl(p.url) !== normalizedUrl);

    // Add back to recent (at the front)
    const newRecent = [page, ...recentPages].slice(0, RECENT_PAGES_LIMIT);

    set({ pinnedPages: newPinned, recentPages: newRecent }, false, 'unpinPage');
    savePinnedPages(newPinned);
  },

  updateRecentPageTitle: (url, title) => {
    const { pinnedPages, recentPages } = get();
    const normalizedUrl = normalizeUrl(url);

    let pinnedUpdated = false;
    let recentUpdated = false;

    // Update in pinned pages
    const newPinned = pinnedPages.map((p) => {
      if (normalizeUrl(p.url) === normalizedUrl && p.title !== title) {
        pinnedUpdated = true;
        return { ...p, title };
      }
      return p;
    });

    // Update in recent pages
    const newRecent = recentPages.map((p) => {
      if (normalizeUrl(p.url) === normalizedUrl && p.title !== title) {
        recentUpdated = true;
        return { ...p, title };
      }
      return p;
    });

    if (pinnedUpdated || recentUpdated) {
      set(
        {
          pinnedPages: pinnedUpdated ? newPinned : pinnedPages,
          recentPages: recentUpdated ? newRecent : recentPages,
        },
        false,
        'updateRecentPageTitle',
      );

      // Persist pinned pages if updated
      if (pinnedUpdated) {
        savePinnedPages(newPinned);
      }
    }
  },
});
