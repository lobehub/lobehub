import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';
import { useParams, usePathname } from '@/libs/router/navigation';
import { useElectronStore } from '@/store/electron';
import { initialState } from '@/store/electron/initialState';
import { useUserStore } from '@/store/user';

import ActiveTabRouterStoreProvider from './ActiveTabRouterStoreProvider';
import { MAX_LIVE_TAB_ROUTERS } from './resolveLiveTabIds';
import TabHost from './TabHost';
import TabLocationReporter from './TabLocationReporter';
import {
  getOrCreateTabRouter,
  getTabHistorySnapshot,
  getTabRouter,
  resetTabRouterManager,
  type TabRouter,
} from './tabRouterManager';

const TestRoute = () => {
  const { id } = useParams<{ id?: string }>('id');
  return React.createElement('div', { 'data-testid': `param-${id}` }, id);
};

interface Creation {
  dispose: ReturnType<typeof vi.spyOn>;
  router: TabRouter;
  url: string;
}

let created: Creation[];
const initialUserState = useUserStore.getState();

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
  useUserStore.setState({
    isUserStateInit: true,
    preference: {
      ...initialUserState.preference,
      lab: { ...initialUserState.preference.lab, enableDesktopSplitView: true },
    },
  });
});

afterEach(() => {
  cleanup();
  resetTabRouterManager();
  useUserStore.setState(initialUserState, true);
});

describe('TabHost', () => {
  it('keeps the shell mounted while boot switches from the outer router to the active tab', async () => {
    const lifecycle = { cleanups: 0, mounts: 0 };
    const ShellProbe = () => {
      const pathname = usePathname();

      React.useEffect(() => {
        lifecycle.mounts += 1;
        return () => {
          lifecycle.cleanups += 1;
        };
      }, []);

      return React.createElement('div', { 'data-testid': 'shell-pathname' }, pathname);
    };
    const outerRouter = createMemoryRouter(
      [
        {
          element: React.createElement(
            ActiveTabRouterStoreProvider,
            null,
            React.createElement(ShellProbe),
          ),
          path: '*',
        },
      ],
      { initialEntries: ['/'] },
    );

    getOrCreateTabRouter('a', '/item/a', createTestRouter);
    render(React.createElement(RouterProvider, { router: outerRouter }));

    expect(await screen.findByTestId('shell-pathname')).toHaveTextContent('/');

    act(() => {
      setStore([{ id: 'a', lastVisited: 1, url: '/item/a' }], 'a');
    });

    await waitFor(() => expect(screen.getByTestId('shell-pathname')).toHaveTextContent('/item/a'));
    expect(lifecycle).toEqual({ cleanups: 0, mounts: 1 });
  });

  it('cold-starts only the active restored tab inside the outer data router', async () => {
    setStore(
      [
        { id: 'a', lastVisited: 2, url: '/item/a' },
        { id: 'b', lastVisited: 1, url: '/item/b' },
      ],
      'a',
    );

    const outerRouter = createMemoryRouter(
      [
        {
          element: React.createElement(TabHost, { createRouter: createTestRouter }),
          path: '*',
        },
      ],
      { initialEntries: ['/'] },
    );

    render(React.createElement(RouterProvider, { router: outerRouter }));

    expect(await screen.findByTestId('param-a')).toHaveTextContent('a');
    expect(screen.queryByTestId('param-b')).not.toBeInTheDocument();
  });

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
    expect(screen.queryByTestId('param-b')).not.toBeInTheDocument();

    act(() => {
      useElectronStore.getState().activateTab('b');
    });

    expect(await screen.findByTestId('param-b')).toHaveTextContent('b');
    expect(screen.getByTestId('param-a')).toHaveTextContent('a');
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

    await screen.findByTestId('param-a');
    act(() => useElectronStore.getState().activateTab('b'));
    await screen.findByTestId('param-b');
    act(() => useElectronStore.getState().activateTab('a'));

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

  it('keeps both split panes visible and moves focus without hiding either router', async () => {
    const tabs = [
      { id: 'a', lastVisited: 2, url: '/item/a' },
      { id: 'b', lastVisited: 1, url: '/item/b' },
    ];
    useElectronStore.setState({
      ...initialState,
      activeTabId: 'a',
      splitView: { primaryTabId: 'a', ratio: 0.5, secondaryTabId: 'b' },
      tabs,
    });

    renderHost();

    const slotA = (await screen.findByTestId('param-a')).parentElement!;
    const slotB = (await screen.findByTestId('param-b')).parentElement!;
    expect(slotA.style.display).toBe('');
    expect(slotB.style.display).toBe('');
    expect(slotA).toHaveAttribute('data-pane', 'primary');
    expect(slotB).toHaveAttribute('data-pane', 'secondary');

    act(() => {
      slotB.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });

    expect(useElectronStore.getState().activeTabId).toBe('b');
    expect(slotA.style.display).toBe('');
    expect(slotB.style.display).toBe('');

    act(() => {
      useElectronStore.setState({ activeTabId: 'a' });
      slotB.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });

    expect(useElectronStore.getState().activeTabId).toBe('b');
  });

  it('collapses a persisted split when the alpha lab is disabled', async () => {
    useUserStore.setState({
      preference: {
        ...initialUserState.preference,
        lab: { ...initialUserState.preference.lab, enableDesktopSplitView: false },
      },
    });
    useElectronStore.setState({
      ...initialState,
      activeTabId: 'a',
      splitView: { primaryTabId: 'a', ratio: 0.5, secondaryTabId: 'b' },
      tabs: [
        { id: 'a', lastVisited: 2, url: '/item/a' },
        { id: 'b', lastVisited: 1, url: '/item/b' },
      ],
    });

    renderHost();

    expect(await screen.findByTestId('param-a')).toBeVisible();
    expect(screen.queryByTestId('param-b')).not.toBeInTheDocument();
    await waitFor(() => expect(useElectronStore.getState().splitView).toBeNull());
  });

  it('disposes a router evicted past the LRU cap and recreates it fresh when reactivated', async () => {
    const baseTabs: TabItem[] = Array.from({ length: MAX_LIVE_TAB_ROUTERS }, (_, index) => ({
      id: `t${index}`,
      lastVisited: 10 - index,
      url: `/item/t${index}`,
    }));
    const oldest = baseTabs[0];

    setStore(baseTabs, 't0');
    renderHost();

    for (const entry of baseTabs.slice(1)) {
      act(() => useElectronStore.getState().activateTab(entry.id));
      await screen.findByTestId(`param-${entry.id}`);
    }
    expect(created).toHaveLength(MAX_LIVE_TAB_ROUTERS);

    const withEvictor: TabItem[] = [
      ...useElectronStore.getState().tabs,
      { id: 'evictor', lastVisited: Date.now() + 1, url: '/item/evictor' },
    ];
    act(() => {
      useElectronStore.setState({ activeTabId: 'evictor', tabs: withEvictor });
    });

    const oldestEntry = created.find((entry) => entry.url === oldest.url)!;
    await vi.waitFor(() => expect(oldestEntry.dispose).toHaveBeenCalled());

    const reactivated: TabItem[] = withEvictor.map((entry) =>
      entry.id === oldest.id ? { ...entry, lastVisited: 30 } : entry,
    );
    act(() => {
      useElectronStore.setState({ activeTabId: oldest.id, tabs: reactivated });
    });

    await screen.findByTestId(`param-${oldest.id}`);

    const oldestCreations = created.filter((entry) => entry.url === oldest.url);
    expect(oldestCreations).toHaveLength(2);
    expect(oldestCreations[1].router).not.toBe(oldestCreations[0].router);
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

    for (const filler of fillers.slice(0, MAX_LIVE_TAB_ROUTERS)) {
      act(() => useElectronStore.getState().activateTab(filler.id));
      await screen.findByTestId(`param-${filler.id}`);
    }

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
    const fillers: TabItem[] = Array.from({ length: MAX_LIVE_TAB_ROUTERS - 1 }, (_, index) => ({
      id: `f${index}`,
      lastVisited: 10 + index,
      url: `/item/f${index}`,
    }));

    setStore([target, ...fillers], target.id);
    renderHost();

    await screen.findByTestId('param-target');

    for (const filler of fillers) {
      act(() => useElectronStore.getState().activateTab(filler.id));
      await screen.findByTestId(`param-${filler.id}`);
    }

    const targetRouter = created.find((entry) => entry.url === '/item/target')!.router;
    await act(async () => {
      await targetRouter.navigate('/item/moved');
    });

    // Reporter never fired for the hidden tab, so the store keeps the pre-nav url.
    expect(useElectronStore.getState().tabs.find((t) => t.id === 'target')!.url).toBe(
      '/item/target',
    );

    // A newly active tab pushes the oldest (`target`) out of the live set.
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

    act(() => useElectronStore.getState().activateTab('b'));
    await vi.waitFor(() => expect(getTabRouter('b')).toBeDefined());
    act(() => useElectronStore.getState().activateTab('a'));

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

  it('replays a navigation that landed while the tab was hidden once it becomes active', async () => {
    setStore(
      [
        { id: 'a', lastVisited: 2, url: '/agent/a' },
        { id: 'b', lastVisited: 1, url: '/agent/b' },
      ],
      'a',
    );

    render(React.createElement(TabHost, { createRouter: createReporterRouter }));

    await screen.findByTestId('param-a');
    act(() => useElectronStore.getState().activateTab('b'));
    await screen.findByTestId('param-b');
    act(() => useElectronStore.getState().activateTab('a'));

    const hiddenRouter = created.find((entry) => entry.url === '/agent/b')!.router;
    await act(async () => {
      await hiddenRouter.navigate('/agent/moved');
    });

    // The hidden tree keeps rendering the pre-navigation match: `<Activity
    // mode="hidden">` tore down `RouterProvider`'s subscription.
    expect(screen.getByTestId('param-b')).toBeInTheDocument();

    act(() => {
      useElectronStore.setState({ activeTabId: 'b' });
    });

    expect(await screen.findByTestId('param-moved')).toHaveTextContent('moved');
    expect(screen.queryByTestId('param-b')).not.toBeInTheDocument();
    expect(useElectronStore.getState().tabs.find((t) => t.id === 'b')!.url).toBe('/agent/moved');
    expect(getTabHistorySnapshot('b').canGoBack).toBe(true);
  });
});
