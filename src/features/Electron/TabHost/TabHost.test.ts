import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { createMemoryRouter, Outlet, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';
import { useElectronStore } from '@/store/electron';
import { initialState } from '@/store/electron/initialState';

import TabHost from './TabHost';
import TabLocationReporter from './TabLocationReporter';
import {
  getTabHistorySnapshot,
  getTabRouter,
  resetTabRouterManager,
  type TabRouter,
} from './tabRouterManager';

const TestRoute = () => {
  const { id } = useParams();
  return React.createElement('div', { 'data-testid': `param-${id}` }, id);
};

interface Creation {
  dispose: ReturnType<typeof vi.spyOn>;
  router: TabRouter;
  url: string;
}

let created: Creation[];

const createTestRouter = (url: string): TabRouter => {
  const router = createMemoryRouter(
    [{ element: React.createElement(TestRoute), path: '/item/:id' }],
    { initialEntries: [url] },
  );
  const dispose = vi.spyOn(router, 'dispose');
  created.push({ dispose, router, url });
  return router;
};

const renderHost = () => render(React.createElement(TabHost, { createRouter: createTestRouter }));

const ReporterRoot = () =>
  React.createElement(
    React.Fragment,
    null,
    React.createElement(Outlet),
    React.createElement(TabLocationReporter),
  );

const createReporterRouter = (url: string): TabRouter => {
  const router = createMemoryRouter(
    [
      {
        children: [{ element: React.createElement(TestRoute), path: 'agent/:id' }],
        element: React.createElement(ReporterRoot),
        path: '/',
      },
    ],
    { initialEntries: [url] },
  );
  const dispose = vi.spyOn(router, 'dispose');
  created.push({ dispose, router, url });
  return router;
};

const createScopedRouter = (url: string): TabRouter => {
  const router = createMemoryRouter([{ element: null, path: '*' }], { initialEntries: [url] });
  const dispose = vi.spyOn(router, 'dispose');
  created.push({ dispose, router, url });
  return router;
};

const setStore = (tabs: TabItem[], activeTabId: string | null) => {
  useElectronStore.setState({ ...initialState, activeTabId, tabs });
};

beforeEach(() => {
  created = [];
  window.localStorage.clear();
  resetTabRouterManager();
  setStore([], null);
});

afterEach(() => {
  cleanup();
  resetTabRouterManager();
});

describe('TabHost', () => {
  it('renders each live tab router at its own location so params never bleed across tabs', async () => {
    setStore(
      [
        { id: 'a', lastVisited: 2, url: '/item/a' },
        { id: 'b', lastVisited: 1, url: '/item/b' },
      ],
      'a',
    );

    renderHost();

    expect(await screen.findByTestId('param-a')).toHaveTextContent('a');
    expect(await screen.findByTestId('param-b')).toHaveTextContent('b');
  });

  it('toggles slot visibility when the active tab changes without unmounting the deactivated tab', async () => {
    setStore(
      [
        { id: 'a', lastVisited: 2, url: '/item/a' },
        { id: 'b', lastVisited: 1, url: '/item/b' },
      ],
      'a',
    );

    renderHost();

    const slotA = (await screen.findByTestId('param-a')).parentElement!;
    const slotB = (await screen.findByTestId('param-b')).parentElement!;

    expect(slotA.style.display).toBe('');
    expect(slotB.style.display).toBe('none');

    act(() => {
      useElectronStore.setState({ activeTabId: 'b' });
    });

    expect(screen.getByTestId('param-a')).toBeInTheDocument();
    expect(screen.getByTestId('param-b')).toBeInTheDocument();
    expect(slotA.style.display).toBe('none');
    expect(slotB.style.display).toBe('');
  });

  it('disposes a router evicted past the LRU cap and recreates it fresh when reactivated', async () => {
    const baseTabs: TabItem[] = Array.from({ length: 5 }, (_, index) => ({
      id: `t${index}`,
      lastVisited: 10 - index,
      url: `/item/t${index}`,
    }));

    setStore(baseTabs, 't0');
    renderHost();

    await screen.findByTestId('param-t4');
    expect(created).toHaveLength(5);

    const withT5: TabItem[] = [...baseTabs, { id: 't5', lastVisited: 20, url: '/item/t5' }];
    act(() => {
      useElectronStore.setState({ activeTabId: 't5', tabs: withT5 });
    });

    const t4Entry = created.find((entry) => entry.url === '/item/t4')!;
    await vi.waitFor(() => expect(t4Entry.dispose).toHaveBeenCalled());

    const reactivated: TabItem[] = withT5.map((entry) =>
      entry.id === 't4' ? { ...entry, lastVisited: 30 } : entry,
    );
    act(() => {
      useElectronStore.setState({ activeTabId: 't4', tabs: reactivated });
    });

    await screen.findByTestId('param-t4');

    const t4Creations = created.filter((entry) => entry.url === '/item/t4');
    expect(t4Creations).toHaveLength(2);
    expect(t4Creations[1].router).not.toBe(t4Creations[0].router);
  });

  it('cold-restores an internally-navigated tab at its latest reported url with history reset', async () => {
    const target: TabItem = { id: 'target', lastVisited: 100, url: '/agent/orig' };
    const fillers: TabItem[] = Array.from({ length: 5 }, (_, index) => ({
      id: `f${index}`,
      lastVisited: 10 + index,
      url: `/agent/f${index}`,
    }));

    setStore([target, ...fillers], 'target');
    render(React.createElement(TabHost, { createRouter: createReporterRouter }));

    await screen.findByTestId('param-orig');

    const targetRouter = created.find((entry) => entry.url === '/agent/orig')!.router;
    await act(async () => {
      await targetRouter.navigate('/agent/latest');
    });

    expect(useElectronStore.getState().tabs.find((t) => t.id === 'target')!.url).toBe(
      '/agent/latest',
    );
    expect(getTabHistorySnapshot('target').canGoBack).toBe(true);

    const evicted = useElectronStore
      .getState()
      .tabs.map((t) =>
        t.id === 'target' ? { ...t, lastVisited: 0 } : { ...t, lastVisited: 1000 },
      );
    act(() => {
      useElectronStore.setState({ activeTabId: 'f0', tabs: evicted });
    });

    const targetEntry = created.find((entry) => entry.url === '/agent/orig')!;
    await vi.waitFor(() => expect(targetEntry.dispose).toHaveBeenCalled());

    const reactivated = useElectronStore
      .getState()
      .tabs.map((t) => (t.id === 'target' ? { ...t, lastVisited: 2000 } : t));
    act(() => {
      useElectronStore.setState({ activeTabId: 'target', tabs: reactivated });
    });

    expect(await screen.findByTestId('param-latest')).toHaveTextContent('latest');
    expect(created.filter((entry) => entry.url === '/agent/latest')).toHaveLength(1);
    expect(getTabHistorySnapshot('target').canGoBack).toBe(false);
  });

  it("snapshots a hidden tab's navigated location into the store on LRU eviction", async () => {
    const target: TabItem = { id: 'target', lastVisited: 1, url: '/item/target' };
    const fillers: TabItem[] = Array.from({ length: 4 }, (_, index) => ({
      id: `f${index}`,
      lastVisited: 10 + index,
      url: `/item/f${index}`,
    }));

    // `f3` is active; `target` is hidden but live. `createTestRouter` mounts no
    // reporter, mirroring the real hidden tab whose reporter effect is torn down.
    setStore([target, ...fillers], 'f3');
    renderHost();

    await screen.findByTestId('param-target');

    const targetRouter = created.find((entry) => entry.url === '/item/target')!.router;
    await act(async () => {
      await targetRouter.navigate('/item/moved');
    });

    // Reporter never fired for the hidden tab, so the store keeps the pre-nav url.
    expect(useElectronStore.getState().tabs.find((t) => t.id === 'target')!.url).toBe(
      '/item/target',
    );

    // A newly active sixth tab pushes the oldest (`target`) out of the live set.
    const withEvictor: TabItem[] = [
      ...useElectronStore.getState().tabs,
      { id: 'evictor', lastVisited: 100, url: '/item/evictor' },
    ];
    act(() => {
      useElectronStore.setState({ activeTabId: 'evictor', tabs: withEvictor });
    });

    const targetEntry = created.find((entry) => entry.url === '/item/target')!;
    await vi.waitFor(() => expect(targetEntry.dispose).toHaveBeenCalled());

    // Eviction snapshot captured the router's latest location before disposal.
    expect(useElectronStore.getState().tabs.find((t) => t.id === 'target')!.url).toBe(
      '/item/moved',
    );

    const reactivated = useElectronStore
      .getState()
      .tabs.map((t) => (t.id === 'target' ? { ...t, lastVisited: 200 } : t));
    act(() => {
      useElectronStore.setState({ activeTabId: 'target', tabs: reactivated });
    });

    // Cold restore starts a fresh router at the snapshotted url with reset history.
    expect(await screen.findByTestId('param-moved')).toHaveTextContent('moved');
    expect(created.filter((entry) => entry.url === '/item/moved')).toHaveLength(1);
    expect(getTabHistorySnapshot('target').canGoBack).toBe(false);
  });

  it('disposes every old-scope router and cold-starts the new-scope tab on a cross-scope report', async () => {
    setStore(
      [
        { id: 'a', lastVisited: 2, url: '/item/a' },
        { id: 'b', lastVisited: 1, url: '/item/b' },
      ],
      'a',
    );

    render(React.createElement(TabHost, { createRouter: createScopedRouter }));

    await vi.waitFor(() => {
      expect(getTabRouter('a')).toBeDefined();
      expect(getTabRouter('b')).toBeDefined();
    });

    const navigateA = vi.spyOn(getTabRouter('a')!, 'navigate');
    const navigateB = vi.spyOn(getTabRouter('b')!, 'navigate');

    await act(async () => {
      useElectronStore.getState().reportTabLocation('a', '/team-x/agent/z');
    });

    expect(getTabRouter('a')).toBeUndefined();
    expect(getTabRouter('b')).toBeUndefined();

    expect(navigateA).not.toHaveBeenCalled();
    expect(navigateB).not.toHaveBeenCalled();

    const state = useElectronStore.getState();
    expect(state.activeTabScope).toEqual({ slug: 'team-x', type: 'workspace' });

    const newTab = state.tabs.find((t) => t.url === '/team-x/agent/z')!;
    expect(newTab).toBeDefined();
    expect(newTab.id).not.toBe('a');

    const newRouter = getTabRouter(newTab.id)!;
    expect(newRouter.state.location.pathname).toBe('/team-x/agent/z');
    expect(getTabHistorySnapshot(newTab.id).canGoBack).toBe(false);
  });
});
