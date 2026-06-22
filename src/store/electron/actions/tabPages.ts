import { nanoid } from 'nanoid';

import { guardedMergeCache } from '@/features/Electron/titlebar/TabBar/resolveRouteMeta';
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
  tabs: TabItem[];
}

// ======== Initial State ======== //

export const tabPagesInitialState: TabPagesState = {
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

    this.#set({ activeTabId: id }, false, 'activateTab');
    this.#persist();
  };

  addTab = (url: string, cached?: DynamicRouteMeta, activate = true): string => {
    const normalized = normalizeTabUrl(url);
    const { tabs } = this.#get();
    const existing = tabs.find((t) => normalizeTabUrl(t.url) === normalized);

    if (existing) {
      if (activate) {
        this.#set({ activeTabId: existing.id }, false, 'activateExistingTab');
        this.#persist();
      }
      return existing.id;
    }

    return this.#createTab(url, cached, activate);
  };

  addNewTab = (url: string, cached?: DynamicRouteMeta): string => {
    return this.#createTab(url, cached, true);
  };

  getActiveTab = (): TabItem | null => {
    const { activeTabId, tabs } = this.#get();
    if (!activeTabId) return null;
    return tabs.find((t) => t.id === activeTabId) ?? null;
  };

  loadTabs = (): void => {
    const { tabs, activeTabId } = getTabPages();
    this.#set({ activeTabId, tabs }, false, 'loadTabs');
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

    this.#set({ activeTabId: newActiveId, tabs: newTabs }, false, 'removeTab');
    this.#persist();

    return newActiveId;
  };

  closeLeftTabs = (id: string): void => {
    const { tabs, activeTabId } = this.#get();
    const index = tabs.findIndex((t) => t.id === id);
    if (index <= 0) return;

    const newTabs = tabs.slice(index);
    const newActiveId = newTabs.some((t) => t.id === activeTabId) ? activeTabId : id;

    this.#set({ activeTabId: newActiveId, tabs: newTabs }, false, 'closeLeftTabs');
    this.#persist();
  };

  closeOtherTabs = (id: string): void => {
    const { tabs } = this.#get();
    const target = tabs.find((t) => t.id === id);
    if (!target) return;

    this.#set({ activeTabId: id, tabs: [target] }, false, 'closeOtherTabs');
    this.#persist();
  };

  closeRightTabs = (id: string): void => {
    const { tabs, activeTabId } = this.#get();
    const index = tabs.findIndex((t) => t.id === id);
    if (index < 0 || index >= tabs.length - 1) return;

    const newTabs = tabs.slice(0, index + 1);
    const newActiveId = newTabs.some((t) => t.id === activeTabId) ? activeTabId : id;

    this.#set({ activeTabId: newActiveId, tabs: newTabs }, false, 'closeRightTabs');
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

  #persist = (): void => {
    const { tabs, activeTabId } = this.#get();
    saveTabPages(tabs, activeTabId);
  };
}

export type TabPagesAction = Pick<TabPagesActionImpl, keyof TabPagesActionImpl>;
