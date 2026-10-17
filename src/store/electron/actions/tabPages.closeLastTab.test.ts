import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PERSONAL_TAB_SCOPE, type TabScope } from '@/features/Electron/titlebar/TabBar/scope';
import { getTabPages } from '@/features/Electron/titlebar/TabBar/storage';
import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';
import { useElectronStore } from '@/store/electron';
import { initialState } from '@/store/electron/initialState';

const seed = (tab: TabItem, activeTabScope: TabScope = PERSONAL_TAB_SCOPE) => {
  const { result } = renderHook(() => useElectronStore());
  act(() => {
    useElectronStore.setState({ activeTabId: tab.id, activeTabScope, tabs: [tab] });
  });
  return result;
};

const topicTab: TabItem = { id: 'topic', lastVisited: 1, url: '/agent/a1?topic=t1' };

describe('closing the last tab', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useElectronStore.setState({ ...initialState, activeTabId: null, tabs: [] });
  });

  it('replaces it with a fresh home tab and focuses it', () => {
    const result = seed(topicTab);

    let returned: string | null = null;
    act(() => {
      returned = result.current.removeTab('topic');
    });

    const { activeTabId, splitView, tabs } = result.current;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].url).toBe('/');
    expect(tabs[0].id).not.toBe('topic');
    expect(activeTabId).toBe(tabs[0].id);
    expect(returned).toBe(tabs[0].id);
    expect(splitView).toBeNull();
  });

  it('lands on the workspace home inside a workspace scope', () => {
    const result = seed(
      { id: 'ws-topic', lastVisited: 1, url: '/acme/agent/a1' },
      { slug: 'acme', type: 'workspace' },
    );

    act(() => {
      result.current.removeTab('ws-topic');
    });

    expect(result.current.tabs.map((tab) => tab.url)).toEqual(['/acme']);
  });

  it('closes a pinned last tab too', () => {
    const result = seed({ ...topicTab, pinned: true });

    act(() => {
      result.current.removeTab('topic');
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0]).toMatchObject({ url: '/' });
    expect(result.current.tabs[0].pinned).toBeUndefined();
  });

  it('persists the home tab so a relaunch does not restore the closed one', () => {
    const result = seed(topicTab);

    act(() => {
      result.current.removeTab('topic');
    });

    const persisted = getTabPages(PERSONAL_TAB_SCOPE);
    expect(persisted.tabs.map((tab) => tab.url)).toEqual(['/']);
    expect(persisted.activeTabId).toBe(result.current.activeTabId);
  });
});
