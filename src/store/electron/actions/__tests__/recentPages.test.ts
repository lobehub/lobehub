import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PINNED_PAGES_STORAGE_KEY_V3,
  pinnedPagesStorageKey,
} from '@/features/Electron/titlebar/RecentlyViewed/storage';
import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';
import { useElectronStore } from '@/store/electron';
import { initialState } from '@/store/electron/initialState';

vi.mock('@/features/Electron/titlebar/TabBar/resolveRouteMeta', () => ({
  guardedMergeCache: (prev: TabItem['cached'], next: TabItem['cached']) => ({ ...prev, ...next }),
}));

const buildTab = (url: string, cached?: TabItem['cached']): TabItem => ({
  cached,
  id: url,
  lastVisited: 1,
  url,
});

describe('recentPages actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useElectronStore.setState({
      ...initialState,
      pinnedPageBuckets: {},
      pinnedPages: [],
      recentPageBuckets: {},
      recentPages: [],
    });
  });

  describe('addRecentPage', () => {
    it('switches between personal and workspace recent buckets', () => {
      const { result } = renderHook(() => useElectronStore());

      act(() => {
        result.current.addRecentPage('/agent/abc');
        result.current.addRecentPage('/acme/agent/abc');
      });

      expect(result.current.activeRecentScope).toEqual({ slug: 'acme', type: 'workspace' });
      expect(result.current.recentPages.map((page) => page.id)).toEqual(['/acme/agent/abc']);

      act(() => {
        result.current.loadPinnedPages('/agent/abc');
      });

      expect(result.current.activeRecentScope).toEqual({ type: 'personal' });
      expect(result.current.recentPages.map((page) => page.id)).toEqual(['/agent/abc']);
    });

    it('dedupes within the active workspace bucket', () => {
      const { result } = renderHook(() => useElectronStore());

      act(() => {
        result.current.addRecentPage('/acme/agent/abc?b=2&a=1');
        result.current.addRecentPage('/acme/agent/abc?a=1&b=2');
      });

      expect(result.current.recentPages).toHaveLength(1);
      expect(result.current.recentPages[0].id).toBe('/acme/agent/abc?a=1&b=2');
      expect(result.current.recentPages[0].visitCount).toBe(2);
    });
  });

  // Regression: recent entries were recorded from the url alone, so every goal / topic /
  // document fell back to its static route label ("Goals", "Goals", "Goals").
  describe('resolved titles', () => {
    const goalUrl = '/agent/agt_1/goal/goal_1';

    it('seeds a new recent entry from the open tab that already resolved its title', () => {
      useElectronStore.setState({
        tabs: [{ ...buildTab(goalUrl, { title: 'Ship the launch post' }), id: 'tab_1' }],
      });
      const { result } = renderHook(() => useElectronStore());

      act(() => {
        result.current.addRecentPage(goalUrl);
      });

      expect(result.current.recentPages[0].cached?.title).toBe('Ship the launch post');
    });

    it('carries a title resolved after the visit into the recent entry without reordering', () => {
      useElectronStore.setState({ tabs: [{ ...buildTab(goalUrl), id: 'tab_1' }] });
      const { result } = renderHook(() => useElectronStore());

      act(() => {
        result.current.addRecentPage(goalUrl);
        result.current.addRecentPage('/agent/agt_1/goals');
      });
      const before = result.current.recentPages.map((page) => [page.id, page.lastVisited]);

      act(() => {
        result.current.updateTabCache('tab_1', { title: 'Ship the launch post' });
      });

      const entry = result.current.recentPages.find((page) => page.id === goalUrl);
      expect(entry?.cached?.title).toBe('Ship the launch post');
      expect(result.current.recentPages.map((page) => [page.id, page.lastVisited])).toEqual(before);
    });

    it('carries a resolved title into a pinned entry and persists it', () => {
      useElectronStore.setState({ tabs: [{ ...buildTab(goalUrl), id: 'tab_1' }] });
      const { result } = renderHook(() => useElectronStore());

      act(() => {
        result.current.pinPage(buildTab(goalUrl));
        result.current.updateTabCache('tab_1', { title: 'Ship the launch post' });
      });

      expect(result.current.pinnedPages[0].cached?.title).toBe('Ship the launch post');
      expect(window.localStorage.getItem(pinnedPagesStorageKey({ type: 'personal' }))).toContain(
        'Ship the launch post',
      );
    });
  });

  describe('pinPage', () => {
    it('pins personal and workspace URLs into independent buckets', () => {
      const { result } = renderHook(() => useElectronStore());

      act(() => {
        result.current.pinPage(buildTab('/agent/abc'));
        result.current.pinPage(buildTab('/acme/agent/abc'));
      });

      expect(result.current.activeRecentScope).toEqual({ slug: 'acme', type: 'workspace' });
      expect(result.current.pinnedPages.map((page) => page.id)).toEqual(['/acme/agent/abc']);

      act(() => {
        result.current.loadPinnedPages('/agent/abc');
      });

      expect(result.current.activeRecentScope).toEqual({ type: 'personal' });
      expect(result.current.pinnedPages.map((page) => page.id)).toEqual(['/agent/abc']);
    });

    it('removes only the matching recent entry from the active bucket when pinning', () => {
      const { result } = renderHook(() => useElectronStore());

      act(() => {
        result.current.addRecentPage('/agent/abc');
        result.current.addRecentPage('/acme/agent/abc');
        result.current.pinPage(buildTab('/acme/agent/abc'));
      });

      expect(result.current.pinnedPages.map((page) => page.id)).toEqual(['/acme/agent/abc']);
      expect(result.current.recentPages.map((page) => page.id)).toEqual([]);

      act(() => {
        result.current.loadPinnedPages('/agent/abc');
      });

      expect(result.current.pinnedPages.map((page) => page.id)).toEqual([]);
      expect(result.current.recentPages.map((page) => page.id)).toEqual(['/agent/abc']);
    });

    it('does not load legacy global pinned data', () => {
      window.localStorage.setItem(
        PINNED_PAGES_STORAGE_KEY_V3,
        JSON.stringify([{ id: '/agent/abc', lastVisited: 1, url: '/agent/abc' }]),
      );
      const { result } = renderHook(() => useElectronStore());

      act(() => {
        result.current.loadPinnedPages('/agent/abc');
      });

      expect(result.current.pinnedPages).toEqual([]);
    });
  });
});
