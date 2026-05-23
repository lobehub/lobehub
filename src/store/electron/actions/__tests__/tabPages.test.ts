import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';
import { useElectronStore } from '@/store/electron';
import { initialState } from '@/store/electron/initialState';

const buildTab = (url: string, cached?: TabItem['cached']): TabItem => ({
  cached,
  id: url,
  lastVisited: 1,
  url,
});

describe('tabPages actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useElectronStore.setState({ ...initialState, activeTabId: null, tabs: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('addTab', () => {
    it('uses the normalized URL as the tab id', () => {
      const { result } = renderHook(() => useElectronStore());

      act(() => {
        result.current.addTab('/agent/abc?b=2&a=1');
      });

      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].id).toBe('/agent/abc?a=1&b=2');
      expect(result.current.activeTabId).toBe('/agent/abc?a=1&b=2');
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

  describe('updateTab', () => {
    it('drops cached data when the tab navigates to a different page', () => {
      const { result } = renderHook(() => useElectronStore());
      const agentTab = buildTab('/agent/abc', { title: 'Claude Code' });

      act(() => {
        useElectronStore.setState({ activeTabId: agentTab.id, tabs: [agentTab] });
      });

      act(() => {
        result.current.updateTab(agentTab.id, '/');
      });

      const updatedTab = result.current.tabs[0];
      expect(updatedTab.id).toBe('/');
      expect(updatedTab.cached).toBeUndefined();
      expect(result.current.activeTabId).toBe('/');
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
