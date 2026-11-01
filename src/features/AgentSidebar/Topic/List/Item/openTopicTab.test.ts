import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushHiddenTabRestores } from '@/features/Electron/TabHost/hiddenTabRestore';
import {
  getOrCreateTabRouter,
  resetTabRouterManager,
} from '@/features/Electron/TabHost/tabRouterManager';
import { useElectronStore } from '@/store/electron';
import { initialState } from '@/store/electron/initialState';

import { openTopicInNewTab, recordTopicClickOrigin } from './openTopicTab';

const makeRouter = (url: string) =>
  createMemoryRouter([{ element: null, path: '*' }], { initialEntries: [url] });

const seedActiveTab = (url: string) => {
  useElectronStore.setState({
    ...initialState,
    activeTabId: 'origin',
    tabs: [{ id: 'origin', lastVisited: 1, url }],
  });
  return getOrCreateTabRouter('origin', url, makeRouter);
};

beforeEach(() => {
  window.localStorage.clear();
  resetTabRouterManager();
});

afterEach(() => {
  resetTabRouterManager();
  useElectronStore.setState(initialState);
});

describe('openTopicInNewTab', () => {
  it('opens the topic in a new tab and puts the clicked tab back where it was', async () => {
    const router = seedActiveTab('/agent/a/tpc_before');

    recordTopicClickOrigin('tpc_next');
    await router.navigate('/agent/a/tpc_next', { replace: true });
    useElectronStore.getState().reportTabLocation('origin', '/agent/a/tpc_next');

    openTopicInNewTab('tpc_next', '/agent/a/tpc_next');

    const { activeTabId, tabs } = useElectronStore.getState();
    expect(tabs).toHaveLength(2);
    expect(activeTabId).not.toBe('origin');
    expect(tabs.find((tab) => tab.id === activeTabId)!.url).toBe('/agent/a/tpc_next');

    flushHiddenTabRestores([activeTabId!]);
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/agent/a/tpc_before'));
    expect(useElectronStore.getState().tabs.find((tab) => tab.id === 'origin')!.url).toBe(
      '/agent/a/tpc_before',
    );
  });

  it('keeps the single tab when the topic was already open in it', () => {
    seedActiveTab('/agent/a/tpc_same');

    recordTopicClickOrigin('tpc_same');
    openTopicInNewTab('tpc_same', '/agent/a/tpc_same');

    const { activeTabId, tabs } = useElectronStore.getState();
    expect(tabs).toHaveLength(1);
    expect(activeTabId).toBe('origin');
  });

  it('activates another tab that already holds the topic instead of duplicating it', () => {
    seedActiveTab('/agent/a/tpc_before');
    useElectronStore.setState({
      tabs: [
        ...useElectronStore.getState().tabs,
        { id: 'existing', lastVisited: 0, url: '/agent/a/tpc_next' },
      ],
    });

    recordTopicClickOrigin('tpc_next');
    useElectronStore.getState().reportTabLocation('origin', '/agent/a/tpc_next');
    openTopicInNewTab('tpc_next', '/agent/a/tpc_next');

    const { activeTabId, tabs } = useElectronStore.getState();
    expect(tabs).toHaveLength(2);
    expect(activeTabId).toBe('existing');
  });
});
