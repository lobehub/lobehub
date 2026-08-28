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
  splitView: SplitViewState | null;
  tabs: TabItem[];
}

export interface SplitViewState {
  /**
   * The tab `duplicatedTabId` was copied from. Recorded at split time because
   * panes can be replaced afterwards — deriving the source from "the other
   * pane" later would point at whatever tab happens to sit there.
   */
  duplicatedFromTabId?: string;
  /**
   * Tab created by copying the active tab when it was split against itself.
   * It only exists to mirror its source side-by-side and is removed as soon as
   * it leaves the split, so no stray duplicate tab survives the session.
   */
  duplicatedTabId?: string;
  primaryTabId: string;
  ratio: number;
  secondaryTabId: string;
}

// ======== Initial State ======== //

export const tabPagesInitialState: TabPagesState = {
  activeTabScope: PERSONAL_TAB_SCOPE,
  activeTabId: null,
  splitView: null,
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
    const { activeTabId, splitView, tabs } = this.#get();
    if (!tabs.some((t) => t.id === id)) return;

    const cleaned = this.#dropDisplacedDuplicate(
      splitView,
      this.#replaceFocusedPane(splitView, activeTabId, id),
      tabs,
      id,
    );

    this.#set(
      {
        activeTabId: cleaned.activeTabId,
        splitView: cleaned.splitView,
        tabs: this.#touch(cleaned.tabs, cleaned.activeTabId),
      },
      false,
      'activateTab',
    );
    this.#persist();
  };

  switchTab = (id: string): void => {
    const { splitView, tabs } = this.#get();
    if (!tabs.some((t) => t.id === id)) return;

    const cleaned = this.#dropDisplacedDuplicate(splitView, null, tabs, id);

    this.#set(
      {
        activeTabId: cleaned.activeTabId,
        splitView: null,
        tabs: this.#touch(cleaned.tabs, cleaned.activeTabId),
      },
      false,
      'switchTab',
    );
    this.#persist();
  };

  addTab = (url: string, cached?: DynamicRouteMeta, activate = true): string => {
    this.#ensureScopeForUrl(url);
    const { tabs } = this.#get();
    const existing = tabs.find((t) => isSameTabTarget(t, url));

    if (existing) {
      if (activate) {
        this.activateTab(existing.id);
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

  closeSplitView = (): void => {
    const { activeTabId, splitView, tabs } = this.#get();
    if (!splitView) return;

    const cleaned = this.#dropDisplacedDuplicate(splitView, null, tabs, activeTabId);

    this.#set(
      {
        activeTabId: cleaned.activeTabId,
        splitView: null,
        // #touch keeps the promoted source tab's keep-alive recency fresh — see #touch.
        tabs: this.#touch(cleaned.tabs, cleaned.activeTabId),
      },
      false,
      'closeSplitView',
    );
    this.#persist();
  };

  focusTabPane = (id: string): void => {
    const { splitView, tabs } = this.#get();
    if (!splitView) return;
    if (id !== splitView.primaryTabId && id !== splitView.secondaryTabId) return;

    this.#set({ activeTabId: id, tabs: this.#touch(tabs, id) }, false, 'focusTabPane');
    this.#persist();
  };

  openTabInSplitView = (id: string): string | null => {
    const { activeTabId, splitView, tabs } = this.#get();
    const target = tabs.find((tab) => tab.id === id);
    if (!target || !activeTabId) return null;

    const primaryTabId = splitView?.primaryTabId ?? activeTabId;
    if (splitView?.secondaryTabId === id) {
      this.focusTabPane(id);
      return id;
    }

    const now = Date.now();
    const shouldDuplicate = id === primaryTabId;
    const secondaryTabId = shouldDuplicate ? generateTabId() : id;
    const nextTabs = shouldDuplicate
      ? [
          ...tabs,
          {
            ...target,
            id: secondaryTabId,
            lastVisited: now,
            pinned: false,
          },
        ]
      : this.#touch(tabs, id);

    const nextSplitView: SplitViewState = {
      duplicatedFromTabId: shouldDuplicate ? id : undefined,
      duplicatedTabId: shouldDuplicate ? secondaryTabId : undefined,
      primaryTabId,
      ratio: splitView?.ratio ?? 0.5,
      secondaryTabId,
    };
    const cleaned = this.#dropDisplacedDuplicate(
      splitView,
      nextSplitView,
      nextTabs,
      secondaryTabId,
    );

    this.#set(
      {
        activeTabId: cleaned.activeTabId,
        splitView: cleaned.splitView,
        tabs: cleaned.tabs,
      },
      false,
      'openTabInSplitView',
    );
    this.#persist();
    return secondaryTabId;
  };

  setSplitRatio = (ratio: number): void => {
    const { splitView } = this.#get();
    if (!splitView) return;

    const nextRatio = Math.min(0.75, Math.max(0.25, ratio));
    if (nextRatio === splitView.ratio) return;
    this.#set({ splitView: { ...splitView, ratio: nextRatio } }, false, 'setSplitRatio');
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

    const reconciled = this.#reconcileSplitView(newTabs, newActiveId);
    newActiveId = reconciled.activeTabId;

    this.#set(
      {
        activeTabId: newActiveId,
        splitView: reconciled.splitView,
        tabs: this.#touch(reconciled.tabs, newActiveId),
      },
      false,
      'removeTab',
    );
    this.#persist();

    return newActiveId;
  };

  closeLeftTabs = (id: string): void => {
    const { tabs } = this.#get();
    const index = tabs.findIndex((t) => t.id === id);
    if (index <= 0) return;

    this.#closeExcept((_, i) => i >= index, id, 'closeLeftTabs');
  };

  closeOtherTabs = (id: string): void => {
    const { tabs } = this.#get();
    if (!tabs.some((t) => t.id === id)) return;

    this.#closeExcept((tab) => tab.id === id, id, 'closeOtherTabs');
  };

  closeRightTabs = (id: string): void => {
    const { tabs } = this.#get();
    const index = tabs.findIndex((t) => t.id === id);
    if (index < 0 || index >= tabs.length - 1) return;

    this.#closeExcept((_, i) => i <= index, id, 'closeRightTabs');
  };

  reorderTabs = (fromIndex: number, toIndex: number): void => {
    const { tabs } = this.#get();
    if (fromIndex < 0 || fromIndex >= tabs.length) return;
    if (toIndex < 0 || toIndex >= tabs.length) return;
    // Pinned tabs form a run at the head of the list; a drag across that boundary would
    // interleave the two groups and desync array order from render order.
    if (!!tabs[fromIndex].pinned !== !!tabs[toIndex].pinned) return;

    const newTabs = [...tabs];
    const [moved] = newTabs.splice(fromIndex, 1);
    newTabs.splice(toIndex, 0, moved);

    this.#set({ tabs: newTabs }, false, 'reorderTabs');
    this.#persist();
  };

  pinTab = (id: string): void => {
    this.#setPinned(id, true);
  };

  unpinTab = (id: string): void => {
    this.#setPinned(id, false);
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

  // Pinning is a retention promise, so a bulk close only ever narrows the unpinned run —
  // a pinned tab leaves solely through removeTab, where the user named that one tab.
  // Focus therefore stays put unless the close actually took the active tab.
  #closeExcept = (
    keep: (tab: TabItem, index: number) => boolean,
    targetId: string,
    action: string,
  ): void => {
    const { tabs, activeTabId } = this.#get();
    const newTabs = tabs.filter((tab, index) => tab.pinned || keep(tab, index));
    if (newTabs.length === tabs.length) return;

    const preferredActiveId = newTabs.some((t) => t.id === activeTabId) ? activeTabId : targetId;
    const reconciled = this.#reconcileSplitView(newTabs, preferredActiveId);

    this.#set(
      {
        activeTabId: reconciled.activeTabId,
        splitView: reconciled.splitView,
        tabs: this.#touch(reconciled.tabs, reconciled.activeTabId),
      },
      false,
      action,
    );
    this.#persist();
  };

  // Pinning moves the tab to the end of the pinned run, unpinning to the first slot
  // after it. Array order must equal render order, or Mod+1–9, Ctrl+Tab cycling and drag
  // reorder would each describe a different sequence.
  #setPinned = (id: string, pinned: boolean): void => {
    const { tabs } = this.#get();
    const index = tabs.findIndex((t) => t.id === id);
    if (index < 0 || !!tabs[index].pinned === pinned) return;

    const target: TabItem = { ...tabs[index], pinned };
    const rest = tabs.filter((_, i) => i !== index);
    const firstUnpinned = rest.findIndex((t) => !t.pinned);
    const position = firstUnpinned < 0 ? rest.length : firstUnpinned;

    this.#set(
      { tabs: [...rest.slice(0, position), target, ...rest.slice(position)] },
      false,
      pinned ? 'pinTab' : 'unpinTab',
    );
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

  #replaceFocusedPane = (
    splitView: SplitViewState | null,
    activeTabId: string | null,
    nextTabId: string,
  ): SplitViewState | null => {
    if (!splitView) return null;
    if (nextTabId === splitView.primaryTabId || nextTabId === splitView.secondaryTabId) {
      return splitView;
    }

    return activeTabId === splitView.secondaryTabId
      ? { ...splitView, secondaryTabId: nextTabId }
      : { ...splitView, primaryTabId: nextTabId };
  };

  // A duplicated pane that leaves the split (the split collapses or another tab takes
  // its pane) must not survive as a stray second tab for the same page: closing or
  // revisiting the leftover forces a hidden→visible remount of a pane the user never
  // saw leave. Drop the copy and hand focus back to its source tab instead.
  #dropDisplacedDuplicate = (
    prevSplitView: SplitViewState | null,
    nextSplitView: SplitViewState | null,
    tabs: TabItem[],
    activeTabId: string | null,
  ): Pick<TabPagesState, 'activeTabId' | 'splitView' | 'tabs'> => {
    const duplicatedTabId = prevSplitView?.duplicatedTabId;
    const keep = { activeTabId, splitView: nextSplitView, tabs };
    if (!prevSplitView || !duplicatedTabId) return keep;

    const stillInPane =
      nextSplitView &&
      (nextSplitView.primaryTabId === duplicatedTabId ||
        nextSplitView.secondaryTabId === duplicatedTabId);
    if (stillInPane) return keep;

    const sourceTabId = prevSplitView.duplicatedFromTabId;
    // The source tab already closed, so the copy is the page's only remaining tab.
    if (!sourceTabId || !tabs.some((tab) => tab.id === sourceTabId)) return keep;

    return {
      activeTabId: activeTabId === duplicatedTabId ? sourceTabId : activeTabId,
      splitView: nextSplitView
        ? { ...nextSplitView, duplicatedFromTabId: undefined, duplicatedTabId: undefined }
        : null,
      tabs: tabs.filter((tab) => tab.id !== duplicatedTabId),
    };
  };

  #reconcileSplitView = (
    tabs: TabItem[],
    preferredActiveId: string | null,
  ): Pick<TabPagesState, 'activeTabId' | 'splitView' | 'tabs'> => {
    const { splitView } = this.#get();
    if (!splitView) return { activeTabId: preferredActiveId, splitView: null, tabs };

    const tabIds = new Set(tabs.map((tab) => tab.id));
    const hasPrimary = tabIds.has(splitView.primaryTabId);
    const hasSecondary = tabIds.has(splitView.secondaryTabId);
    if (hasPrimary && hasSecondary) return { activeTabId: preferredActiveId, splitView, tabs };

    const remainingPaneId = hasPrimary
      ? splitView.primaryTabId
      : hasSecondary
        ? splitView.secondaryTabId
        : null;
    return this.#dropDisplacedDuplicate(
      splitView,
      null,
      tabs,
      remainingPaneId ?? preferredActiveId,
    );
  };

  #createTab = (url: string, cached: DynamicRouteMeta | undefined, activate: boolean): string => {
    const { tabs, activeTabId, splitView } = this.#get();
    const id = generateTabId();
    const newTab: TabItem = {
      cached,
      id,
      lastVisited: Date.now(),
      url,
    };

    const withNew = [...tabs, newTab];
    const cleaned = activate
      ? this.#dropDisplacedDuplicate(
          splitView,
          this.#replaceFocusedPane(splitView, activeTabId, id),
          withNew,
          id,
        )
      : { activeTabId, splitView, tabs: withNew };

    this.#set(
      {
        activeTabId: activate ? id : activeTabId,
        splitView: cleaned.splitView,
        tabs: cleaned.tabs,
      },
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
    this.#set({ activeTabId, activeTabScope: scope, splitView: null, tabs }, false, 'loadTabs');
  };
}

export type TabPagesAction = Pick<TabPagesActionImpl, keyof TabPagesActionImpl>;
