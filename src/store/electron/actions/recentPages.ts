import {
  getPinnedPages,
  savePinnedPages,
} from '@/features/Electron/titlebar/RecentlyViewed/storage';
import { guardedMergeCache } from '@/features/Electron/titlebar/TabBar/resolveRouteMeta';
import {
  isSameTabTarget,
  PERSONAL_TAB_SCOPE,
  resolveTabScope,
  type TabScope,
  tabScopeKey,
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
  activeRecentScope: TabScope;
  pinnedPageBuckets: Record<string, TabItem[]>;
  pinnedPages: TabItem[];
  recentPageBuckets: Record<string, TabItem[]>;
  recentPages: TabItem[];
}

// ======== Initial State ======== //

export const recentPagesInitialState: RecentPagesState = {
  activeRecentScope: PERSONAL_TAB_SCOPE,
  pinnedPageBuckets: {},
  pinnedPages: [],
  recentPageBuckets: {},
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
    this.#ensureScopeForUrl(url);
    const { pinnedPages, recentPages } = this.#get();
    const id = tabTargetId(url);

    const pinnedIndex = pinnedPages.findIndex((p) => isSameTabTarget(p, url));
    if (pinnedIndex >= 0) {
      const merged = guardedMergeCache(pinnedPages[pinnedIndex].cached, cached);
      if (merged === pinnedPages[pinnedIndex].cached) return;

      const updatedPinned = [...pinnedPages];
      updatedPinned[pinnedIndex] = { ...updatedPinned[pinnedIndex], cached: merged };
      this.#set(this.#withActivePinned(updatedPinned), false, 'updatePinnedPageCache');
      this.#savePinned(updatedPinned);
      return;
    }

    const existingIndex = recentPages.findIndex((p) => isSameTabTarget(p, url));
    const existingEntry = existingIndex >= 0 ? recentPages[existingIndex] : null;

    const newEntry: TabItem = {
      cached: guardedMergeCache(existingEntry?.cached, cached),
      id,
      lastVisited: Date.now(),
      url,
      visitCount: (existingEntry?.visitCount || 0) + 1,
    };

    const filtered =
      existingIndex >= 0 ? recentPages.filter((_, i) => i !== existingIndex) : recentPages;

    const newRecent = [newEntry, ...filtered].slice(0, RECENT_PAGES_LIMIT);

    this.#set(this.#withActiveRecent(newRecent), false, 'addRecentPage');
  };

  clearRecentPages = (): void => {
    this.#set(this.#withActiveRecent([]), false, 'clearRecentPages');
  };

  isPagePinned = (id: string): boolean => {
    return this.#get().pinnedPages.some((p) => p.id === id);
  };

  loadPinnedPages = (url?: string): void => {
    this.#loadScope(url ? resolveTabScope(url) : this.#get().activeTabScope, true);
  };

  pinPage = (page: TabItem): void => {
    this.#ensureScopeForUrl(page.url);
    const { pinnedPages, recentPages } = this.#get();
    const id = tabTargetId(page.url);

    if (pinnedPages.some((p) => isSameTabTarget(p, page.url))) return;
    if (pinnedPages.length >= PINNED_PAGES_LIMIT) return;

    const existingRecent = recentPages.find((p) => isSameTabTarget(p, page.url));

    const newEntry: TabItem = {
      ...page,
      cached: page.cached ?? existingRecent?.cached,
      id,
      lastVisited: Date.now(),
    };

    const newPinned = [...pinnedPages, newEntry];
    const filteredRecent = recentPages.filter(
      (recentPage) => !isSameTabTarget(recentPage, page.url),
    );

    this.#set(
      {
        ...this.#withActivePinned(newPinned),
        ...this.#withActiveRecent(filteredRecent),
      },
      false,
      'pinPage',
    );
    this.#savePinned(newPinned);
  };

  removeRecentPage = (id: string): void => {
    const { recentPages } = this.#get();
    this.#set(
      this.#withActiveRecent(recentPages.filter((p) => p.id !== id)),
      false,
      'removeRecentPage',
    );
  };

  unpinPage = (id: string): void => {
    const { pinnedPages, recentPages } = this.#get();
    const page = pinnedPages.find((p) => p.id === id);

    if (!page) return;

    const newPinned = pinnedPages.filter((p) => p.id !== id);
    const newRecent = [page, ...recentPages].slice(0, RECENT_PAGES_LIMIT);

    this.#set(
      {
        ...this.#withActivePinned(newPinned),
        ...this.#withActiveRecent(newRecent),
      },
      false,
      'unpinPage',
    );
    this.#savePinned(newPinned);
  };

  #ensureScopeForUrl = (url: string): void => {
    this.#loadScope(resolveTabScope(url));
  };

  #loadScope = (scope: TabScope, force = false): void => {
    const { activeRecentScope, pinnedPageBuckets, pinnedPages, recentPageBuckets, recentPages } =
      this.#get();
    const currentKey = tabScopeKey(activeRecentScope);
    const nextKey = tabScopeKey(scope);
    if (!force && currentKey === nextKey) return;

    const nextRecentBuckets = {
      ...recentPageBuckets,
      [currentKey]: recentPages,
    };
    const nextPinnedBuckets = {
      ...pinnedPageBuckets,
      [currentKey]: pinnedPages,
    };

    const nextPinned = force
      ? getPinnedPages(scope)
      : (nextPinnedBuckets[nextKey] ?? getPinnedPages(scope));
    const nextRecent = nextRecentBuckets[nextKey] ?? [];

    this.#set(
      {
        activeRecentScope: scope,
        pinnedPageBuckets: { ...nextPinnedBuckets, [nextKey]: nextPinned },
        pinnedPages: nextPinned,
        recentPageBuckets: { ...nextRecentBuckets, [nextKey]: nextRecent },
        recentPages: nextRecent,
      },
      false,
      'loadPinnedPages',
    );
  };

  #savePinned = (pages: TabItem[]): void => {
    savePinnedPages(this.#get().activeRecentScope, pages);
  };

  #withActivePinned = (pages: TabItem[]) => {
    const key = tabScopeKey(this.#get().activeRecentScope);
    return {
      pinnedPageBuckets: { ...this.#get().pinnedPageBuckets, [key]: pages },
      pinnedPages: pages,
    };
  };

  #withActiveRecent = (pages: TabItem[]) => {
    const key = tabScopeKey(this.#get().activeRecentScope);
    return {
      recentPageBuckets: { ...this.#get().recentPageBuckets, [key]: pages },
      recentPages: pages,
    };
  };
}

export type RecentPagesAction = Pick<RecentPagesActionImpl, keyof RecentPagesActionImpl>;
