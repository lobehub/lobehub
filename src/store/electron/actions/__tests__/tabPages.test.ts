import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type PageReference } from '@/features/Electron/titlebar/RecentlyViewed/types';
import { useElectronStore } from '@/store/electron';
import { initialState } from '@/store/electron/initialState';

const buildAgentTab = (agentId = 'abc123'): PageReference => ({
  cached: {
    avatar: 'avatar.png',
    backgroundColor: '#fff',
    title: 'Claude Code',
  },
  id: `agent:${agentId}`,
  lastVisited: 1,
  params: { agentId },
  type: 'agent',
});

const buildHomeReference = (): PageReference => ({
  id: 'home',
  lastVisited: Date.now(),
  params: {},
  type: 'home',
});

describe('tabPages actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useElectronStore.setState({ ...initialState, activeTabId: null, tabs: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('updateTab', () => {
    it('drops stale cached data when the tab switches to a different page type', () => {
      const { result } = renderHook(() => useElectronStore());
      const agentTab = buildAgentTab();

      act(() => {
        useElectronStore.setState({ activeTabId: agentTab.id, tabs: [agentTab] });
      });

      act(() => {
        // Simulate navigating from an agent page to the home page. `useTabNavigation`
        // passes no cached data for home, so the previous agent's cached title
        // must not leak through.
        result.current.updateTab(agentTab.id, buildHomeReference(), undefined);
      });

      const updatedTab = result.current.tabs[0];
      expect(updatedTab.type).toBe('home');
      expect(updatedTab.id).toBe('home');
      expect(updatedTab.cached).toBeUndefined();
      expect(result.current.activeTabId).toBe('home');
    });

    it('merges cached data when the tab type stays the same', () => {
      const { result } = renderHook(() => useElectronStore());
      const agentTab = buildAgentTab('abc');

      act(() => {
        useElectronStore.setState({ activeTabId: agentTab.id, tabs: [agentTab] });
      });

      act(() => {
        result.current.updateTab(
          agentTab.id,
          {
            id: 'agent:xyz',
            lastVisited: Date.now(),
            params: { agentId: 'xyz' },
            type: 'agent',
          },
          { title: 'New Agent' },
        );
      });

      const updatedTab = result.current.tabs[0];
      expect(updatedTab.id).toBe('agent:xyz');
      expect(updatedTab.cached).toEqual({
        avatar: 'avatar.png',
        backgroundColor: '#fff',
        title: 'New Agent',
      });
    });

    it('keeps previous cached data when same-type update passes undefined cached', () => {
      const { result } = renderHook(() => useElectronStore());
      const agentTab = buildAgentTab('abc');

      act(() => {
        useElectronStore.setState({ activeTabId: agentTab.id, tabs: [agentTab] });
      });

      act(() => {
        result.current.updateTab(
          agentTab.id,
          {
            id: 'agent:xyz',
            lastVisited: Date.now(),
            params: { agentId: 'xyz' },
            type: 'agent',
          },
          undefined,
        );
      });

      expect(result.current.tabs[0].cached).toEqual(agentTab.cached);
    });

    it('overwrites cached data when switching to a different type, even if cached is provided', () => {
      const { result } = renderHook(() => useElectronStore());
      const agentTab = buildAgentTab();

      act(() => {
        useElectronStore.setState({ activeTabId: agentTab.id, tabs: [agentTab] });
      });

      act(() => {
        result.current.updateTab(
          agentTab.id,
          {
            id: 'group:g1',
            lastVisited: Date.now(),
            params: { groupId: 'g1' },
            type: 'group',
          },
          { title: 'My Group' },
        );
      });

      expect(result.current.tabs[0].cached).toEqual({ title: 'My Group' });
    });

    it('does nothing when the tab id is not found', () => {
      const { result } = renderHook(() => useElectronStore());
      const agentTab = buildAgentTab();

      act(() => {
        useElectronStore.setState({ activeTabId: agentTab.id, tabs: [agentTab] });
      });

      act(() => {
        result.current.updateTab('non-existent', buildHomeReference());
      });

      expect(result.current.tabs).toEqual([agentTab]);
      expect(result.current.activeTabId).toBe(agentTab.id);
    });
  });
});
