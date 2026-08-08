import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PINNED_PAGES_STORAGE_KEY_V3 } from '@/features/Electron/titlebar/RecentlyViewed/storage';
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
