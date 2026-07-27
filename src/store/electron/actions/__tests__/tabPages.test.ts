import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveLiveTabIds } from '@/features/Electron/TabHost/resolveLiveTabIds';
import { PERSONAL_TAB_SCOPE } from '@/features/Electron/titlebar/TabBar/scope';
import { getTabPages, saveTabPages } from '@/features/Electron/titlebar/TabBar/storage';
import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';
import { useElectronStore } from '@/store/electron';
import { initialState } from '@/store/electron/initialState';

vi.mock('@/features/Electron/titlebar/TabBar/resolveRouteMeta', () => ({
  guardedMergeCache: (prev: TabItem['cached'], next: TabItem['cached']) => {
    if (!next) return prev;

    const merged: TabItem['cached'] = { ...prev };
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) continue;
      if (typeof value === 'string' && value.trim() === '') continue;
      merged[key as keyof NonNullable<TabItem['cached']>] = value;
    }

    return Object.keys(merged ?? {}).length > 0 ? merged : undefined;
  },
}));

const buildTab = (url: string, cached?: TabItem['cached']): TabItem => ({
  cached,
  id: url,
  lastVisited: 1,
  url,
});

describe('tabPages actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useElectronStore.setState({ ...initialState, activeTabId: null, tabs: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('activation refreshes LRU recency', () => {
    const visitedTab = (url: string, lastVisited: number): TabItem => ({
      ...buildTab(url),
      lastVisited,
    });

    it('keeps a tab activated without navigating alive after the user switches away', () => {
      const { result } = renderHook(() => useElectronStore());
      const oldest = visitedTab('/agent/a', 1);
      const middle = visitedTab('/agent/b', 2);
      const newest = visitedTab('/agent/c', 3);

      act(() => {
        useElectronStore.setState({ activeTabId: newest.id, tabs: [oldest, middle, newest] });
      });

      act(() => {
        result.current.activateTab(oldest.id);
      });
      act(() => {
        result.current.activateTab(newest.id);
      });

      expect(resolveLiveTabIds(result.current.tabs, newest.id, 2)).toEqual([oldest.id, newest.id]);
    });

    it('refreshes recency when addTab reuses an existing tab', () => {
      const { result } = renderHook(() => useElectronStore());
      const existing = visitedTab('/agent/a', 1);

      act(() => {
        useElectronStore.setState({ activeTabId: null, tabs: [existing] });
      });

      act(() => {
        result.current.addTab('/agent/a');
      });

      expect(result.current.tabs[0].lastVisited).toBeGreaterThan(existing.lastVisited);
    });

    it('refreshes recency on the tab promoted to active by a close', () => {
      const { result } = renderHook(() => useElectronStore());
      const closing = visitedTab('/agent/a', 1);
      const promoted = visitedTab('/agent/b', 2);

      act(() => {
        useElectronStore.setState({ activeTabId: closing.id, tabs: [closing, promoted] });
      });

      act(() => {
        result.current.removeTab(closing.id);
      });

      expect(result.current.activeTabId).toBe(promoted.id);
      expect(result.current.tabs[0].lastVisited).toBeGreaterThan(promoted.lastVisited);
    });
  });

  describe('addTab', () => {
    it('creates a tab with a stable generated id and activates it', () => {
      const { result } = renderHook(() => useElectronStore());

      let createdId = '';
      act(() => {
        createdId = result.current.addTab('/agent/abc?b=2&a=1');
      });

      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].id).toBe(createdId);
      expect(result.current.tabs[0].url).toBe('/agent/abc?b=2&a=1');
      expect(result.current.activeTabScope).toEqual({ type: 'personal' });
      expect(result.current.activeTabId).toBe(createdId);
    });

    it('switches the visible tab bucket when the URL moves into a workspace', () => {
      const { result } = renderHook(() => useElectronStore());

      act(() => {
        result.current.addTab('/agent/abc');
        result.current.addTab('/acme/agent/abc');
      });

      expect(result.current.activeTabScope).toEqual({ slug: 'acme', type: 'workspace' });
      expect(result.current.tabs.map((page) => page.url)).toEqual(['/acme/agent/abc']);

      act(() => {
        result.current.loadTabs('/agent/abc');
      });

      expect(result.current.activeTabScope).toEqual({ type: 'personal' });
      expect(result.current.tabs.map((page) => page.url)).toEqual(['/agent/abc']);
    });

    it('dedupes tabs that resolve to the same normalized URL', () => {
      const { result } = renderHook(() => useElectronStore());

      act(() => {
        result.current.addTab('/agent/abc?a=1&b=2');
        result.current.addTab('/agent/abc?b=2&a=1');
      });

      expect(result.current.tabs).toHaveLength(1);
    });

    it('treats a trailing slash as the same identity', () => {
      const { result } = renderHook(() => useElectronStore());

      act(() => {
        result.current.addTab('/agent/abc');
        result.current.addTab('/agent/abc/');
      });

      expect(result.current.tabs).toHaveLength(1);
    });
  });

  describe('addNewTab', () => {
    it('always creates a fresh tab even when the URL already has a tab', () => {
      const { result } = renderHook(() => useElectronStore());

      act(() => {
        result.current.addNewTab('/');
        result.current.addNewTab('/');
        result.current.addNewTab('/');
      });

      expect(result.current.tabs).toHaveLength(3);
      const ids = result.current.tabs.map((t) => t.id);
      expect(new Set(ids).size).toBe(3);
      expect(result.current.tabs.every((t) => t.url === '/')).toBe(true);
      expect(result.current.activeTabId).toBe(result.current.tabs[2].id);
    });
  });

  describe('updateTab', () => {
    it('drops cached data when the tab navigates to a different page but keeps the id stable', () => {
      const { result } = renderHook(() => useElectronStore());
      const agentTab = buildTab('/agent/abc', { title: 'Claude Code' });

      act(() => {
        useElectronStore.setState({ activeTabId: agentTab.id, tabs: [agentTab] });
      });

      act(() => {
        result.current.updateTab(agentTab.id, '/');
      });

      const updatedTab = result.current.tabs[0];
      expect(updatedTab.id).toBe(agentTab.id);
      expect(updatedTab.url).toBe('/');
      expect(updatedTab.cached).toBeUndefined();
      expect(result.current.activeTabId).toBe(agentTab.id);
    });

    it('keeps a tab in the current bucket when updateTab receives a workspace URL directly', () => {
      const { result } = renderHook(() => useElectronStore());
      const agentTab = buildTab('/agent/abc', { title: 'Claude Code' });

      act(() => {
        useElectronStore.setState({ activeTabId: agentTab.id, tabs: [agentTab] });
      });

      act(() => {
        result.current.updateTab(agentTab.id, '/acme/agent/abc');
      });

      expect(result.current.activeTabScope).toEqual({ type: 'personal' });
      expect(result.current.tabs[0].url).toBe('/acme/agent/abc');
      expect(result.current.tabs[0].cached).toBeUndefined();
    });

    it('keeps cached data when the normalized URL is unchanged', () => {
      const { result } = renderHook(() => useElectronStore());
      const agentTab = buildTab('/agent/abc?a=1', { title: 'Claude Code' });

      act(() => {
        useElectronStore.setState({ activeTabId: agentTab.id, tabs: [agentTab] });
      });

      act(() => {
        result.current.updateTab(agentTab.id, '/agent/abc?a=1');
      });

      expect(result.current.tabs[0].cached).toEqual({ title: 'Claude Code' });
    });

    it('does nothing when the tab id is not found', () => {
      const { result } = renderHook(() => useElectronStore());
      const agentTab = buildTab('/agent/abc');

      act(() => {
        useElectronStore.setState({ activeTabId: agentTab.id, tabs: [agentTab] });
      });

      act(() => {
        result.current.updateTab('non-existent', '/');
      });

      expect(result.current.tabs).toEqual([agentTab]);
      expect(result.current.activeTabId).toBe(agentTab.id);
    });
  });

  describe('reportTabLocation', () => {
    it('rewrites the active tab url when the reported url stays in scope', () => {
      const { result } = renderHook(() => useElectronStore());
      const tab = buildTab('/agent/abc');

      act(() => {
        useElectronStore.setState({
          activeTabId: tab.id,
          activeTabScope: PERSONAL_TAB_SCOPE,
          tabs: [tab],
        });
      });

      act(() => {
        result.current.reportTabLocation(tab.id, '/agent/def');
      });

      expect(result.current.activeTabScope).toEqual({ type: 'personal' });
      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].id).toBe(tab.id);
      expect(result.current.tabs[0].url).toBe('/agent/def');
    });

    it('swaps scope, keeps the navigating tab at its pre-nav url in the old scope, and activates a tab in the new scope', () => {
      const { result } = renderHook(() => useElectronStore());
      const personalTab = buildTab('/agent/abc');

      act(() => {
        useElectronStore.setState({
          activeTabId: personalTab.id,
          activeTabScope: PERSONAL_TAB_SCOPE,
          tabs: [personalTab],
        });
      });

      act(() => {
        result.current.reportTabLocation(personalTab.id, '/acme/agent/xyz');
      });

      expect(result.current.activeTabScope).toEqual({ slug: 'acme', type: 'workspace' });
      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].url).toBe('/acme/agent/xyz');
      expect(result.current.activeTabId).toBe(result.current.tabs[0].id);

      const persistedPersonal = getTabPages(PERSONAL_TAB_SCOPE);
      expect(persistedPersonal.tabs.map((t) => t.url)).toEqual(['/agent/abc']);
      expect(persistedPersonal.activeTabId).toBe(personalTab.id);
    });

    it('reuses an existing tab in the target scope instead of duplicating it', () => {
      const { result } = renderHook(() => useElectronStore());
      const acmeScope = { slug: 'acme', type: 'workspace' } as const;
      const existing = buildTab('/acme/agent/xyz');
      saveTabPages(acmeScope, [existing], existing.id);

      const personalTab = buildTab('/agent/abc');
      act(() => {
        useElectronStore.setState({
          activeTabId: personalTab.id,
          activeTabScope: PERSONAL_TAB_SCOPE,
          tabs: [personalTab],
        });
      });

      act(() => {
        result.current.reportTabLocation(personalTab.id, '/acme/agent/xyz');
      });

      expect(result.current.activeTabScope).toEqual(acmeScope);
      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].id).toBe(existing.id);
      expect(result.current.activeTabId).toBe(existing.id);
    });

    it('does nothing when the reported tab id is not found', () => {
      const { result } = renderHook(() => useElectronStore());
      const tab = buildTab('/agent/abc');

      act(() => {
        useElectronStore.setState({
          activeTabId: tab.id,
          activeTabScope: PERSONAL_TAB_SCOPE,
          tabs: [tab],
        });
      });

      act(() => {
        result.current.reportTabLocation('non-existent', '/acme/agent/xyz');
      });

      expect(result.current.activeTabScope).toEqual({ type: 'personal' });
      expect(result.current.tabs).toEqual([tab]);
    });
  });

  describe('snapshotTabLocation', () => {
    it('persists a fragment-only move so an evicted tab cold-restores at its anchor', () => {
      const { result } = renderHook(() => useElectronStore());
      const settingsTab = buildTab('/settings/agent', { title: 'Settings' });

      act(() => {
        useElectronStore.setState({ activeTabId: settingsTab.id, tabs: [settingsTab] });
      });

      act(() => {
        result.current.snapshotTabLocation(settingsTab.id, '/settings/agent#llm');
      });

      expect(result.current.tabs[0].url).toBe('/settings/agent#llm');
      expect(result.current.tabs[0].cached).toEqual({ title: 'Settings' });
      expect(result.current.tabs[0].lastVisited).toBe(settingsTab.lastVisited);
    });

    it('drops cached data when the snapshot lands on a different page', () => {
      const { result } = renderHook(() => useElectronStore());
      const agentTab = buildTab('/agent/abc', { title: 'Claude Code' });

      act(() => {
        useElectronStore.setState({ activeTabId: agentTab.id, tabs: [agentTab] });
      });

      act(() => {
        result.current.snapshotTabLocation(agentTab.id, '/memory');
      });

      expect(result.current.tabs[0].url).toBe('/memory');
      expect(result.current.tabs[0].cached).toBeUndefined();
    });

    it('does nothing when the snapshot repeats the stored url', () => {
      const { result } = renderHook(() => useElectronStore());
      const agentTab = buildTab('/agent/abc', { title: 'Claude Code' });

      act(() => {
        useElectronStore.setState({ activeTabId: agentTab.id, tabs: [agentTab] });
      });

      const before = result.current.tabs;

      act(() => {
        result.current.snapshotTabLocation(agentTab.id, '/agent/abc');
      });

      expect(result.current.tabs).toBe(before);
    });
  });

  describe('updateTabCache (guarded merge)', () => {
    it('skips undefined and empty-string fields, never clobbering a good value', () => {
      const { result } = renderHook(() => useElectronStore());
      const agentTab = buildTab('/agent/abc', {
        avatar: 'avatar.png',
        title: 'Claude Code',
      });

      act(() => {
        useElectronStore.setState({ activeTabId: agentTab.id, tabs: [agentTab] });
      });

      act(() => {
        result.current.updateTabCache(agentTab.id, { avatar: '', title: undefined });
      });

      expect(result.current.tabs[0].cached).toEqual({
        avatar: 'avatar.png',
        title: 'Claude Code',
      });
    });

    it('only writes defined non-empty fields', () => {
      const { result } = renderHook(() => useElectronStore());
      const agentTab = buildTab('/agent/abc', { title: 'Old Title' });

      act(() => {
        useElectronStore.setState({ activeTabId: agentTab.id, tabs: [agentTab] });
      });

      act(() => {
        result.current.updateTabCache(agentTab.id, { avatar: 'a.png', title: 'New Title' });
      });

      expect(result.current.tabs[0].cached).toEqual({
        avatar: 'a.png',
        title: 'New Title',
      });
    });
  });
});
