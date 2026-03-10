import {
  getPinnedPages,
  savePinnedPages,
} from '@/features/Electron/titlebar/RecentlyViewed/storage';
import {
  type CachedPageData,
  type PageReference,
} from '@/features/Electron/titlebar/RecentlyViewed/types';
import { type StoreSetter } from '@/store/types';

import { type ElectronStore } from '../store';

// ======== Constants ======== //

const RECENT_PAGES_LIMIT = 20;
const PINNED_PAGES_LIMIT = 10;

// ======== Types ======== //

export interface RecentPagesState {
  pinnedPages: PageReference[];
  recentPages: PageReference[];
}

// ======== Action Interface ======== //

// ======== Initial State ======== //

export const recentPagesInitialState: RecentPagesState = {
  pinnedPages: [],
  recentPages: [],
};

// ======== Action Implementation ======== //

type Setter = StoreSetter<ElectronStore>;
export const createRecentPagesSlice = (set: Setter, get: () => ElectronStore, _api?: unknown) =>
  new RecentPagesActionImpl(set, get, _api);

export class RecentPagesActionImpl {
  readonly #get: () => ElectronStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ElectronStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  addRecentPage = (reference: PageReference, cached?: CachedPageData): void => {
    const { pinnedPages, recentPages } = this.#get();
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
        this.#set({ pinnedPages: updatedPinned }, false, 'updatePinnedPageCache');
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

    this.#set({ recentPages: newRecent }, false, 'addRecentPage');
  };

  clearRecentPages = (): void => {
    this.#set({ recentPages: [] }, false, 'clearRecentPages');
  };

  isPagePinned = (id: string): boolean => {
    return this.#get().pinnedPages.some((p) => p.id === id);
  };

  loadPinnedPages = (): void => {
    const pinned = getPinnedPages();
    const { recentPages } = this.#get();

    const pinnedIds = new Set(pinned.map((p) => p.id));

    // Filter out any pages from recent that are now in pinned
    // This handles the race condition where addRecentPage runs before loadPinnedPages
    const filteredRecent = recentPages.filter((p) => !pinnedIds.has(p.id));

    this.#set({ pinnedPages: pinned, recentPages: filteredRecent }, false, 'loadPinnedPages');
  };

  pinPage = (reference: PageReference): void => {
    const { pinnedPages, recentPages } = this.#get();
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

    this.#set({ pinnedPages: newPinned, recentPages: newRecent }, false, 'pinPage');
    savePinnedPages(newPinned);
  };

  removeRecentPage = (id: string): void => {
    const { recentPages } = this.#get();
    this.#set({ recentPages: recentPages.filter((p) => p.id !== id) }, false, 'removeRecentPage');
  };

  unpinPage = (id: string): void => {
    const { pinnedPages, recentPages } = this.#get();
    const page = pinnedPages.find((p) => p.id === id);

    if (!page) return;

    const newPinned = pinnedPages.filter((p) => p.id !== id);

    // Add back to recent (at the front)
    const newRecent = [page, ...recentPages].slice(0, RECENT_PAGES_LIMIT);

    this.#set({ pinnedPages: newPinned, recentPages: newRecent }, false, 'unpinPage');
    savePinnedPages(newPinned);
  };
}

export type RecentPagesAction = Pick<RecentPagesActionImpl, keyof RecentPagesActionImpl>;
