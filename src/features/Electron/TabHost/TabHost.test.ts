import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { createMemoryRouter, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';
import { useElectronStore } from '@/store/electron';
import { initialState } from '@/store/electron/initialState';

import TabHost from './TabHost';
import { resetTabRouterManager, type TabRouter } from './tabRouterManager';

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

const setStore = (tabs: TabItem[], activeTabId: string | null) => {
  useElectronStore.setState({ ...initialState, activeTabId, tabs });
};

beforeEach(() => {
  created = [];
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
});
