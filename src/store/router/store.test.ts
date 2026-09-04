/**
 * @vitest-environment happy-dom
 */
import { act, render } from '@testing-library/react';
import React from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { useIsActiveTab } from '@/hooks/useIsActiveTab';
import { useParams } from '@/libs/router/navigation';

import { useRouterStore } from './context';
import { routerSelectors } from './selectors';

describe('router store selectors', () => {
  it('rerenders only consumers whose selected route value changed', async () => {
    const renders = { aid: 0, pathname: 0, search: 0 };

    const PathnameProbe = () => {
      useRouterStore(routerSelectors.pathname);
      renders.pathname += 1;
      return null;
    };
    const SearchProbe = () => {
      useRouterStore(routerSelectors.search);
      renders.search += 1;
      return null;
    };
    const AidProbe = () => {
      useParams<{ aid?: string; topicId?: string }>('aid');
      renders.aid += 1;
      return null;
    };
    const router = createMemoryRouter(
      [
        {
          element: React.createElement(
            React.Fragment,
            null,
            React.createElement(PathnameProbe),
            React.createElement(SearchProbe),
            React.createElement(AidProbe),
          ),
          path: '/agent/:aid/:topicId?',
        },
      ],
      { initialEntries: ['/agent/agent-a/topic-a'] },
    );

    render(React.createElement(RouterProvider, { router }));
    expect(renders).toEqual({ aid: 1, pathname: 1, search: 1 });

    await act(() => router.navigate('/agent/agent-a/topic-a?view=grid'));
    expect(renders).toEqual({ aid: 1, pathname: 1, search: 2 });

    await act(() => router.navigate('/agent/agent-a/topic-b?view=grid'));
    expect(renders).toEqual({ aid: 1, pathname: 2, search: 2 });

    await act(() => router.navigate('/agent/agent-b/topic-b?view=grid'));
    expect(renders).toEqual({ aid: 2, pathname: 3, search: 2 });
  });

  it('rerenders only nav items whose active boolean changed', async () => {
    const renders = { home: 0, resource: 0, tasks: 0 };
    const Probe = ({ itemKey }: { itemKey: keyof typeof renders }) => {
      useIsActiveTab(itemKey);
      renders[itemKey] += 1;
      return null;
    };
    const router = createMemoryRouter(
      [
        {
          element: React.createElement(
            React.Fragment,
            null,
            React.createElement(Probe, { itemKey: 'home' }),
            React.createElement(Probe, { itemKey: 'tasks' }),
            React.createElement(Probe, { itemKey: 'resource' }),
          ),
          path: '*',
        },
      ],
      { initialEntries: ['/'] },
    );

    render(React.createElement(RouterProvider, { router }));
    await act(() => router.navigate('/tasks'));

    expect(renders).toEqual({ home: 2, resource: 1, tasks: 2 });
  });
});
