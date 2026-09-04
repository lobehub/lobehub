import { act, cleanup, renderHook, screen } from '@testing-library/react';
import React, { type PropsWithChildren, useState } from 'react';
import { createMemoryRouter, RouterProvider, UNSAFE_LocationContext } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { create } from 'zustand';

import { routerSelectors, useRouterStore } from '@/store/router';

import { useTopicUrlSync } from './useTopicUrlSync';

const useTopicStore = create<{ activeGenerationTopicId: string | null }>(() => ({
  activeGenerationTopicId: null,
}));

const probe = (testId: string) => () =>
  React.createElement('div', { 'data-testid': testId }, useRouterStore(routerSelectors.search));

const PageProbe = probe('page-search');
const ShellProbe = probe('shell-search');

// Mirrors the desktop shell: `NavPanelShell` — which renders every portal'd
// sidebar — is a sibling of `TabHost` under the frozen root router, and each tab
// resets LocationContext so its own router mounts as a root.
const desktopWrapper =
  (tabEntry: string) =>
  ({ children }: PropsWithChildren) => {
    const [tabRouter] = useState(() =>
      createMemoryRouter(
        [
          {
            element: React.createElement(
              React.Fragment,
              null,
              React.createElement(PageProbe),
              children,
            ),
            path: '*',
          },
        ],
        { initialEntries: [tabEntry] },
      ),
    );
    const [shellRouter] = useState(() =>
      createMemoryRouter(
        [
          {
            element: React.createElement(
              React.Fragment,
              null,
              React.createElement(ShellProbe),
              React.createElement(
                UNSAFE_LocationContext,
                { value: null as never },
                React.createElement(RouterProvider, { router: tabRouter }),
              ),
            ),
            path: '*',
          },
        ],
        { initialEntries: ['/'] },
      ),
    );

    return React.createElement(RouterProvider, { router: shellRouter });
  };

const renderSync = (tabEntry: string) =>
  renderHook(() => useTopicUrlSync(useTopicStore), { wrapper: desktopWrapper(tabEntry) });

beforeEach(() => {
  useTopicStore.setState({ activeGenerationTopicId: null });
});

afterEach(() => {
  cleanup();
});

describe('useTopicUrlSync', () => {
  it('writes the active topic into the router the page reads, not the shell router', async () => {
    renderSync('/image');

    await act(async () => {
      useTopicStore.setState({ activeGenerationTopicId: 'topic-1' });
    });

    expect(screen.getByTestId('page-search').textContent).toBe('?topic=topic-1');
    expect(screen.getByTestId('shell-search').textContent).toBe('');
  });

  it('seeds the store from the page url on mount', () => {
    renderSync('/image?topic=topic-9');

    expect(useTopicStore.getState().activeGenerationTopicId).toBe('topic-9');
  });

  it('clears the topic param when the topic is reset', async () => {
    renderSync('/image?topic=topic-9');

    await act(async () => {
      useTopicStore.setState({ activeGenerationTopicId: null });
    });

    expect(screen.getByTestId('page-search').textContent).toBe('');
  });
});
