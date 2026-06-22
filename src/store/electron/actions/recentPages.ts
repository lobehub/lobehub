import {
  getPinnedPages,
  savePinnedPages,
} from '@/features/Electron/titlebar/RecentlyViewed/storage';
import { guardedMergeCache } from '@/features/Electron/titlebar/TabBar/resolveRouteMeta';
import {
  isSameTabTarget,
  normalizeTabScope,
  resolveTabScope,
  tabTargetId,
} from '@/features/Electron/titlebar/TabBar/scope';
import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';
import { type DynamicRouteMeta } from '@/spa/router/routeMeta';
import { type StoreSetter } from '@/store/types';

import { type ElectronStore } from '../store';

// ======== Constants ======== //

const RECENT_PAGES_LIMIT = 20;
const PINNED_PAGES_LIMIT = 10;

// ======== Types ======== //

export interface RecentPagesState {
  pinnedPages: TabItem[];
  recentPages: TabItem[];
}

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

  addRecentPage = (url: string, cached?: DynamicRouteMeta): void => {
    const { pinnedPages, recentPages } = this.#get();
    const scope = resolveTabScope(url);
    const id = tabTargetId(url);

    const pinnedIndex = pinnedPages.findIndex((p) => isSameTabTarget(p, url, scope));
    if (pinnedIndex >= 0) {
      const merged = guardedMergeCache(pinnedPages[pinnedIndex].cached, cached);
      if (merged === pinnedPages[pinnedIndex].cached) return;

      const updatedPinned = [...pinnedPages];
      updatedPinned[pinnedIndex] = { ...updatedPinned[pinnedIndex], cached: merged };
      this.#set({ pinnedPages: updatedPinned }, false, 'updatePinnedPageCache');
      savePinnedPages(updatedPinned);
      return;
    }

    const existingIndex = recentPages.findIndex((p) => isSameTabTarget(p, url, scope));
    const existingEntry = existingIndex >= 0 ? recentPages[existingIndex] : null;

    const newEntry: TabItem = {
      cached: guardedMergeCache(existingEntry?.cached, cached),
      id,
      lastVisited: Date.now(),
      scope,
      url,
      visitCount: (existingEntry?.visitCount || 0) + 1,
    };

    const filtered =
      existingIndex >= 0 ? recentPages.filter((_, i) => i !== existingIndex) : recentPages;

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

    const filteredRecent = recentPages.filter(
      (recentPage) =>
        !pinned.some((pinnedPage) =>
          isSameTabTarget(
            recentPage,
            pinnedPage.url,
            normalizeTabScope(pinnedPage.scope, pinnedPage.url),
          ),
        ),
    );

    this.#set({ pinnedPages: pinned, recentPages: filteredRecent }, false, 'loadPinnedPages');
  };

  pinPage = (page: TabItem): void => {
    const { pinnedPages, recentPages } = this.#get();
    const scope = normalizeTabScope(page.scope, page.url);
    const id = tabTargetId(page.url);

    if (pinnedPages.some((p) => isSameTabTarget(p, page.url, scope))) return;
    if (pinnedPages.length >= PINNED_PAGES_LIMIT) return;

    const existingRecent = recentPages.find((p) => isSameTabTarget(p, page.url, scope));

    const newEntry: TabItem = {
      ...page,
      cached: page.cached ?? existingRecent?.cached,
      id,
      lastVisited: Date.now(),
      scope,
    };

    const newPinned = [...pinnedPages, newEntry];
    const newRecent = recentPages.filter((p) => !isSameTabTarget(p, page.url, scope));

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
    const newRecent = [page, ...recentPages].slice(0, RECENT_PAGES_LIMIT);

    this.#set({ pinnedPages: newPinned, recentPages: newRecent }, false, 'unpinPage');
    savePinnedPages(newPinned);
  };
}

export type RecentPagesAction = Pick<RecentPagesActionImpl, keyof RecentPagesActionImpl>;
