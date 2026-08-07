import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import { createMemoryRouter, Outlet } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';
import { useElectronStore } from '@/store/electron';
import { initialState } from '@/store/electron/initialState';

import { TabIdContext } from './TabIdContext';
import TabLocationReporter from './TabLocationReporter';

const Root = () =>
  React.createElement(
    React.Fragment,
    null,
    React.createElement(Outlet),
    React.createElement(TabLocationReporter),
  );

const createReporterRouter = (url: string) =>
  createMemoryRouter(
    [{ children: [{ element: null, path: '*' }], element: React.createElement(Root), path: '/' }],
    {
      initialEntries: [url],
    },
  );

const setStore = (tabs: TabItem[], activeTabId: string | null) => {
  useElectronStore.setState({
    ...initialState,
    activeTabId,
    activeTabScope: { slug: 'item', type: 'workspace' },
    tabs,
  });
};

const urlOf = (id: string) => useElectronStore.getState().tabs.find((t) => t.id === id)!.url;

const renderTab = (tabId: string, router: ReturnType<typeof createReporterRouter>) =>
  render(
    React.createElement(
      TabIdContext.Provider,
      { value: tabId },
      React.createElement(RouterProvider, { router }),
    ),
  );

beforeEach(() => {
  setStore([], null);
});

afterEach(() => {
  cleanup();
});

describe('TabLocationReporter', () => {
  it('mirrors the active tab internal navigation into the store url', async () => {
    setStore([{ id: 'a', lastVisited: 1, url: '/item/a' }], 'a');
    const router = createReporterRouter('/item/a');
    renderTab('a', router);

    await act(async () => {
      await router.navigate('/item/a2');
    });

    expect(urlOf('a')).toBe('/item/a2');
  });

  it('keeps the anchor so a reload or cold restore still resolves the deep link', async () => {
    setStore([{ id: 'a', lastVisited: 1, url: '/item/a' }], 'a');
    const router = createReporterRouter('/item/a');
    renderTab('a', router);

    await act(async () => {
      await router.navigate('/item/a?q=1#msg_1');
    });

    expect(urlOf('a')).toBe('/item/a?q=1#msg_1');
  });

  it('does not overwrite the store from a hidden (non-active) tab navigation', async () => {
    setStore(
      [
        { id: 'a', lastVisited: 2, url: '/item/a' },
        { id: 'b', lastVisited: 1, url: '/item/b' },
      ],
      'a',
    );
    const router = createReporterRouter('/item/b');
    renderTab('b', router);

    await act(async () => {
      await router.navigate('/item/bX');
    });

    expect(urlOf('b')).toBe('/item/b');
    expect(urlOf('a')).toBe('/item/a');
  });
});
