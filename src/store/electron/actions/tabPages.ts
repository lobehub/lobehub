import { nanoid } from 'nanoid';

import { guardedMergeCache } from '@/features/Electron/titlebar/TabBar/resolveRouteMeta';
import { resolveTabUpdate } from '@/features/Electron/titlebar/TabBar/resolveTabUpdate';
import {
  isSameTabTarget,
  PERSONAL_TAB_SCOPE,
  resolveTabScope,
  type TabScope,
  tabScopeKey,
} from '@/features/Electron/titlebar/TabBar/scope';
import { getTabPages, saveTabPages } from '@/features/Electron/titlebar/TabBar/storage';
import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';
import { normalizeTabUrl } from '@/features/Electron/titlebar/TabBar/url';
import { type DynamicRouteMeta } from '@/spa/router/routeMeta';
import { type StoreSetter } from '@/store/types';

import { type ElectronStore } from '../store';

const generateTabId = (): string => `tab_${nanoid(8)}`;

// ======== Types ======== //

export interface TabPagesState {
  activeTabId: string | null;
  activeTabScope: TabScope;
  tabs: TabItem[];
}

// ======== Initial State ======== //

export const tabPagesInitialState: TabPagesState = {
  activeTabScope: PERSONAL_TAB_SCOPE,
  activeTabId: null,
  tabs: [],
};

// ======== Action Implementation ======== //

type Setter = StoreSetter<ElectronStore>;
export const createTabPagesSlice = (set: Setter, get: () => ElectronStore, _api?: unknown) =>
  new TabPagesActionImpl(set, get, _api);

export class TabPagesActionImpl {
  readonly #get: () => ElectronStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ElectronStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  activateTab = (id: string): void => {
    const { tabs } = this.#get();
    if (!tabs.some((t) => t.id === id)) return;

    this.#set({ activeTabId: id, tabs: this.#touch(tabs, id) }, false, 'activateTab');
    this.#persist();
  };

  addTab = (url: string, cached?: DynamicRouteMeta, activate = true): string => {
    this.#ensureScopeForUrl(url);
    const { tabs } = this.#get();
    const existing = tabs.find((t) => isSameTabTarget(t, url));

    if (existing) {
      if (activate) {
        this.#set(
          { activeTabId: existing.id, tabs: this.#touch(tabs, existing.id) },
          false,
          'activateExistingTab',
        );
        this.#persist();
      }
      return existing.id;
    }

    return this.#createTab(url, cached, activate);
  };

  addNewTab = (url: string, cached?: DynamicRouteMeta): string => {
    this.#ensureScopeForUrl(url);
    return this.#createTab(url, cached, true);
  };

  getActiveTab = (): TabItem | null => {
    const { activeTabId, tabs } = this.#get();
    if (!activeTabId) return null;
    return tabs.find((t) => t.id === activeTabId) ?? null;
  };

  loadTabs = (url = '/'): void => {
    this.#loadScope(resolveTabScope(url), true);
  };

  removeTab = (id: string): string | null => {
    const { tabs, activeTabId } = this.#get();
    const index = tabs.findIndex((t) => t.id === id);
    if (index < 0) return null;

    const newTabs = tabs.filter((t) => t.id !== id);

    let newActiveId = activeTabId;
    if (activeTabId === id) {
      if (newTabs.length === 0) {
        newActiveId = null;
      } else if (index >= newTabs.length) {
        newActiveId = newTabs.at(-1)!.id;
      } else {
        newActiveId = newTabs[index].id;
      }
    }

    this.#set(
      { activeTabId: newActiveId, tabs: this.#touch(newTabs, newActiveId) },
      false,
      'removeTab',
    );
    this.#persist();

    return newActiveId;
  };

  closeLeftTabs = (id: string): void => {
    const { tabs, activeTabId } = this.#get();
    const index = tabs.findIndex((t) => t.id === id);
    if (index <= 0) return;

    const newTabs = tabs.slice(index);
    const newActiveId = newTabs.some((t) => t.id === activeTabId) ? activeTabId : id;

    this.#set(
      { activeTabId: newActiveId, tabs: this.#touch(newTabs, newActiveId) },
      false,
      'closeLeftTabs',
    );
    this.#persist();
  };

  closeOtherTabs = (id: string): void => {
    const { tabs } = this.#get();
    const target = tabs.find((t) => t.id === id);
    if (!target) return;

    this.#set({ activeTabId: id, tabs: this.#touch([target], id) }, false, 'closeOtherTabs');
    this.#persist();
  };

  closeRightTabs = (id: string): void => {
    const { tabs, activeTabId } = this.#get();
    const index = tabs.findIndex((t) => t.id === id);
    if (index < 0 || index >= tabs.length - 1) return;

    const newTabs = tabs.slice(0, index + 1);
    const newActiveId = newTabs.some((t) => t.id === activeTabId) ? activeTabId : id;

    this.#set(
      { activeTabId: newActiveId, tabs: this.#touch(newTabs, newActiveId) },
      false,
      'closeRightTabs',
    );
    this.#persist();
  };

  reorderTabs = (fromIndex: number, toIndex: number): void => {
    const { tabs } = this.#get();
    if (fromIndex < 0 || fromIndex >= tabs.length) return;
    if (toIndex < 0 || toIndex >= tabs.length) return;

    const newTabs = [...tabs];
    const [moved] = newTabs.splice(fromIndex, 1);
    newTabs.splice(toIndex, 0, moved);

    this.#set({ tabs: newTabs }, false, 'reorderTabs');
    this.#persist();
  };

  updateTab = (id: string, url: string): string => {
    const { tabs } = this.#get();
    const index = tabs.findIndex((t) => t.id === id);
    if (index < 0) return id;

    const prev = tabs[index];
    const sameTarget = normalizeTabUrl(url) === normalizeTabUrl(prev.url);

    const newTabs = [...tabs];
    newTabs[index] = {
      ...prev,
      cached: sameTarget ? prev.cached : undefined,
      lastVisited: Date.now(),
      url,
    };

    this.#set({ tabs: newTabs }, false, 'updateTab');
    this.#persist();
    return id;
  };

  // Router→store snapshot taken by TabHost right before a hidden tab's router is
  // LRU-evicted: a pinned navigation into a hidden tab moves its router but the
  // hidden reporter can't fire, so persist the latest location for cold restore.
  // `lastVisited` is intentionally preserved so the snapshot doesn't reshuffle
  // the LRU ranking (which would re-promote the just-evicted tab).
  snapshotTabLocation = (id: string, url: string): void => {
    const { tabs } = this.#get();
    const index = tabs.findIndex((t) => t.id === id);
    if (index < 0) return;

    const prev = tabs[index];
    if (url === prev.url) return;

    const sameTarget = normalizeTabUrl(url) === normalizeTabUrl(prev.url);

    const newTabs = [...tabs];
    newTabs[index] = { ...prev, cached: sameTarget ? prev.cached : undefined, url };

    this.#set({ tabs: newTabs }, false, 'snapshotTabLocation');
    this.#persist();
  };

  reportTabLocation = (id: string, url: string): void => {
    const { activeTabScope, tabs } = this.#get();
    if (!tabs.some((t) => t.id === id)) return;

    const action = resolveTabUpdate(activeTabScope, url);
    if (action.type === 'scope-swap') {
      this.#swapScope(action.scope, action.url);
      return;
    }

    this.updateTab(id, url);
  };

  updateTabCache = (id: string, cached: DynamicRouteMeta): void => {
    const { tabs } = this.#get();
    const index = tabs.findIndex((t) => t.id === id);
    if (index < 0) return;

    const merged = guardedMergeCache(tabs[index].cached, cached);
    if (merged === tabs[index].cached) return;

    const newTabs = [...tabs];
    newTabs[index] = { ...newTabs[index], cached: merged };

    this.#set({ tabs: newTabs }, false, 'updateTabCache');
    this.#persist();
  };

  // Every path that makes a tab active must refresh its `lastVisited`: TabHost
  // ranks keep-alive routers by that timestamp, so a tab activated without a
  // navigation would stay at its stale recency and get its router disposed (and
  // its in-page state lost) the moment the user switches away again.
  #touch = (tabs: TabItem[], id: string | null): TabItem[] => {
    if (!id) return tabs;
    const index = tabs.findIndex((t) => t.id === id);
    if (index < 0) return tabs;

    const newTabs = [...tabs];
    newTabs[index] = { ...newTabs[index], lastVisited: Date.now() };
    return newTabs;
  };

  #createTab = (url: string, cached: DynamicRouteMeta | undefined, activate: boolean): string => {
    const { tabs, activeTabId } = this.#get();
    const id = generateTabId();
    const newTab: TabItem = {
      cached,
      id,
      lastVisited: Date.now(),
      url,
    };

    this.#set(
      { activeTabId: activate ? id : activeTabId, tabs: [...tabs, newTab] },
      false,
      'addTab',
    );
    this.#persist();
    return id;
  };

  // Cross-scope in-tab navigation reported by TabLocationReporter: persist the
  // old scope with the navigating tab still at its pre-nav url (it stays in the
  // old window), load the target scope, then find-or-add + activate a tab there.
  // TabHost disposes the old-scope routers once `tabs` swaps (one-way; no router
  // is ever navigated from here).
  #swapScope = (scope: TabScope, url: string): void => {
    this.#persist();
    this.#loadScope(scope, true);
    this.addTab(url);
  };

  #persist = (): void => {
    const { activeTabScope, tabs, activeTabId } = this.#get();
    saveTabPages(activeTabScope, tabs, activeTabId);
  };

  #ensureScopeForUrl = (url: string): void => {
    const scope = resolveTabScope(url);
    const { activeTabScope } = this.#get();
    if (tabScopeKey(activeTabScope) === tabScopeKey(scope)) return;

    this.#loadScope(scope);
  };

  #loadScope = (scope: TabScope, force = false): void => {
    const { activeTabScope } = this.#get();
    if (!force && tabScopeKey(activeTabScope) === tabScopeKey(scope)) return;

    const { tabs, activeTabId } = getTabPages(scope);
    this.#set({ activeTabId, activeTabScope: scope, tabs }, false, 'loadTabs');
  };
}

export type TabPagesAction = Pick<TabPagesActionImpl, keyof TabPagesActionImpl>;
