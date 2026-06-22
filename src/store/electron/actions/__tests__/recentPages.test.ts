import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveTabScope } from '@/features/Electron/titlebar/TabBar/scope';
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
  scope: resolveTabScope(url),
  url,
});

describe('recentPages actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useElectronStore.setState({ ...initialState, pinnedPages: [], recentPages: [] });
  });

  describe('addRecentPage', () => {
    it('keeps personal and workspace URLs as separate recent entries', () => {
      const { result } = renderHook(() => useElectronStore());

      act(() => {
        result.current.addRecentPage('/agent/abc');
        result.current.addRecentPage('/acme/agent/abc');
      });

      expect(result.current.recentPages.map((page) => page.id)).toEqual([
        '/acme/agent/abc',
        '/agent/abc',
      ]);
      expect(result.current.recentPages.map((page) => page.scope)).toEqual([
        { slug: 'acme', type: 'workspace' },
        { type: 'personal' },
      ]);
    });

    it('dedupes only within the same normalized workspace URL', () => {
      const { result } = renderHook(() => useElectronStore());

      act(() => {
        result.current.addRecentPage('/acme/agent/abc?b=2&a=1');
        result.current.addRecentPage('/acme/agent/abc?a=1&b=2');
      });

      expect(result.current.recentPages).toHaveLength(1);
      expect(result.current.recentPages[0].id).toBe('/acme/agent/abc?a=1&b=2');
      expect(result.current.recentPages[0].scope).toEqual({
        slug: 'acme',
        type: 'workspace',
      });
      expect(result.current.recentPages[0].visitCount).toBe(2);
    });
  });

  describe('pinPage', () => {
    it('pins personal and workspace URLs independently', () => {
      const { result } = renderHook(() => useElectronStore());

      act(() => {
        result.current.pinPage(buildTab('/agent/abc'));
        result.current.pinPage(buildTab('/acme/agent/abc'));
      });

      expect(result.current.pinnedPages.map((page) => page.id)).toEqual([
        '/agent/abc',
        '/acme/agent/abc',
      ]);
    });

    it('removes only the matching scoped recent entry when pinning', () => {
      const { result } = renderHook(() => useElectronStore());

      act(() => {
        result.current.addRecentPage('/agent/abc');
        result.current.addRecentPage('/acme/agent/abc');
        result.current.pinPage(buildTab('/acme/agent/abc'));
      });

      expect(result.current.pinnedPages.map((page) => page.id)).toEqual(['/acme/agent/abc']);
      expect(result.current.recentPages.map((page) => page.id)).toEqual(['/agent/abc']);
    });
  });
});
