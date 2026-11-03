import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOrCreateTabRouter, resetTabRouterManager } from '@/features/Electron/TabHost';
import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';
import { useElectronStore } from '@/store/electron';
import { initialState } from '@/store/electron/initialState';

import { appNavigate } from './appNavigate.desktop';

vi.mock('@/features/Electron/titlebar/TabBar/resolveRouteMeta', () => ({
  guardedMergeCache: (prev: TabItem['cached']) => prev,
}));

// T-2802: tabs A and B are open, B is focused, A's run finishes in the background
// and the user clicks the completion notification.
const TAB_A_URL = '/agent/agt_a/tpc_a';
const TAB_B_URL = '/agent/agt_b/tpc_b';

const tab = (id: string, url: string): TabItem => ({ id, lastVisited: 1, url });

const seedTabs = () => {
  useElectronStore.setState({
    activeTabId: 'tab-b',
    tabs: [tab('tab-a', TAB_A_URL), tab('tab-b', TAB_B_URL)],
  });

  const makeRouter = (url: string) =>
    createMemoryRouter([{ element: null, path: '*' }], { initialEntries: [url] });

  return {
    routerA: getOrCreateTabRouter('tab-a', TAB_A_URL, makeRouter),
    routerB: getOrCreateTabRouter('tab-b', TAB_B_URL, makeRouter),
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('appNavigate existingTab target with the real tab store (T-2802)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useElectronStore.setState({ ...initialState, activeTabId: null, tabs: [] });
  });

  afterEach(() => {
    resetTabRouterManager();
  });

  it('activates tab A and leaves tab B untouched when A already shows the conversation', async () => {
    const { routerA, routerB } = seedTabs();

    appNavigate(TAB_A_URL, { escape: true, replace: false, target: 'existingTab' });
    await flush();

    const { activeTabId, tabs } = useElectronStore.getState();
    expect(activeTabId).toBe('tab-a');
    expect(tabs.map((t) => [t.id, t.url])).toEqual([
      ['tab-a', TAB_A_URL],
      ['tab-b', TAB_B_URL],
    ]);
    expect(routerA.state.location.pathname).toBe(TAB_A_URL);
    expect(routerB.state.location.pathname).toBe(TAB_B_URL);
  });

  it('keeps the previous behavior (navigate the focused tab) when no tab shows the conversation', async () => {
    const { routerB } = seedTabs();

    appNavigate('/agent/agt_c/tpc_c', { escape: true, replace: false, target: 'existingTab' });
    await flush();

    expect(useElectronStore.getState().activeTabId).toBe('tab-b');
    expect(useElectronStore.getState().tabs).toHaveLength(2);
    expect(routerB.state.location.pathname).toBe('/agent/agt_c/tpc_c');
  });

  it('reproduces the A A bug on the legacy active-tab path', async () => {
    const { routerB } = seedTabs();

    appNavigate(TAB_A_URL, { escape: true, replace: false });
    await flush();

    expect(useElectronStore.getState().activeTabId).toBe('tab-b');
    // B's router now shows A's conversation — TabLocationReporter would mirror it into the store.
    expect(routerB.state.location.pathname).toBe(TAB_A_URL);
  });
});
