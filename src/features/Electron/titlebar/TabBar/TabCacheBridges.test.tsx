import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MessageSquare } from 'lucide-react';
import type * as ReactModule from 'react';
import { useMemo, useState } from 'react';
import { type RouteObject } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type DynamicRouteMeta, type RouteMeta } from '@/spa/router/routeMeta';

import TabCacheBridges from './TabCacheBridges';
import { type TabItem } from './types';

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const routes = { current: [] as RouteObject[] };
  const tabs: { current: TabItem[] } = { current: [] };
  const emit = () => {
    for (const listener of listeners) listener();
  };

  return {
    getTabs: () => tabs.current,
    routes,
    setRoutes: (next: RouteObject[]) => {
      tabs.current = [];
      routes.current = next;
      emit();
    },
    setTabs: (next: TabItem[]) => {
      tabs.current = next;
      emit();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateTabCache: vi.fn<(id: string, cached: DynamicRouteMeta) => void>(),
  };
});

vi.mock('@/spa/router/desktopRouter.config', () => ({
  get desktopRoutes() {
    return mocks.routes.current;
  },
}));

interface ElectronState {
  tabs: TabItem[];
  updateTabCache: typeof mocks.updateTabCache;
}

vi.mock('@/store/electron', async () => {
  const React = await vi.importActual<typeof ReactModule>('react');

  return {
    useElectronStore: (selector: (state: ElectronState) => unknown) => {
      const tabs = React.useSyncExternalStore(mocks.subscribe, mocks.getTabs, mocks.getTabs);

      return selector({ tabs, updateTabCache: mocks.updateTabCache });
    },
  };
});

const dynamicSource: Record<string, DynamicRouteMeta> = {};
const resolveTopicMeta = (params: Record<string, string | undefined>): DynamicRouteMeta => {
  const key = [params.workspaceSlug ?? 'personal', params.topicId ?? params.topic ?? ''].join(':');
  return dynamicSource[key] ?? {};
};

const agentMeta: RouteMeta = {
  icon: MessageSquare,
  titleKey: 'navigation.chat',
  useDynamicMeta: resolveTopicMeta,
};

const staticMeta: RouteMeta = {
  icon: MessageSquare,
  titleKey: 'navigation.lobehub',
};

const buildRoutes = (): RouteObject[] => [
  {
    children: [
      { handle: { meta: agentMeta }, path: 'agent/:aid/:topicId' },
      { handle: { meta: staticMeta }, path: 'settings' },
    ],
    path: '/',
  },
];

const tab = (url: string): TabItem => ({
  id: url,
  lastVisited: 1,
  url,
});

const stableTab = (id: string, url: string): TabItem => ({
  id,
  lastVisited: 1,
  url,
});

const workspaceHomeMetaWithHook: RouteMeta = {
  titleKey: 'navigation.home',
  useDynamicMeta: () => {
    const [title] = useState('Workspace Home');

    return { title };
  },
};

const agentMetaWithExtraHook: RouteMeta = {
  icon: MessageSquare,
  titleKey: 'navigation.chat',
  useDynamicMeta: () => {
    const [prefix] = useState('Agent');
    const suffix = useMemo(() => 'Detail', []);

    return { title: `${prefix} ${suffix}` };
  },
};

const buildWorkspaceRoutesWithChangingMetaHooks = (): RouteObject[] => [
  {
    children: [
      {
        children: [
          { handle: { meta: workspaceHomeMetaWithHook }, index: true },
          { handle: { meta: agentMetaWithExtraHook }, path: 'agent/:aid' },
        ],
        path: ':workspaceSlug',
      },
    ],
    path: '/',
  },
];

describe('TabCacheBridges', () => {
  afterEach(() => {
    cleanup();
    mocks.updateTabCache.mockReset();
    mocks.setTabs([]);
    mocks.routes.current = [];
    for (const key of Object.keys(dynamicSource)) delete dynamicSource[key];
  });

  it('pushes dynamic meta into each tab cache, including inactive tabs', async () => {
    mocks.routes.current = buildRoutes();
    mocks.setTabs([tab('/agent/a1/topic-A'), tab('/agent/a1/topic-B')]);
    dynamicSource['personal:topic-A'] = { title: 'Topic A' };
    dynamicSource['personal:topic-B'] = { title: 'Topic B' };

    render(<TabCacheBridges />);

    await waitFor(() => {
      expect(mocks.updateTabCache).toHaveBeenCalledWith(
        '/agent/a1/topic-A',
        expect.objectContaining({ title: 'Topic A' }),
      );
      expect(mocks.updateTabCache).toHaveBeenCalledWith(
        '/agent/a1/topic-B',
        expect.objectContaining({ title: 'Topic B' }),
      );
    });
  });

  it('resolves dynamic meta from each tab url scope and query params', async () => {
    mocks.routes.current = [
      {
        children: [
          {
            children: [{ handle: { meta: agentMeta }, path: 'agent/:aid' }],
            path: ':workspaceSlug',
          },
        ],
        path: '/',
      },
    ];
    mocks.setTabs([tab('/acme/agent/a1?topic=topic-A'), tab('/beta/agent/a1?topic=topic-A')]);
    dynamicSource['acme:topic-A'] = { title: 'Acme Topic' };
    dynamicSource['beta:topic-A'] = { title: 'Beta Topic' };

    render(<TabCacheBridges />);

    await waitFor(() => {
      expect(mocks.updateTabCache).toHaveBeenCalledWith(
        '/acme/agent/a1?topic=topic-A',
        expect.objectContaining({ title: 'Acme Topic' }),
      );
      expect(mocks.updateTabCache).toHaveBeenCalledWith(
        '/beta/agent/a1?topic=topic-A',
        expect.objectContaining({ title: 'Beta Topic' }),
      );
    });
  });

  it('skips tabs whose route has no useDynamicMeta', async () => {
    mocks.routes.current = buildRoutes();
    mocks.setTabs([tab('/settings')]);

    render(<TabCacheBridges />);

    await waitFor(() => {
      expect(mocks.updateTabCache).not.toHaveBeenCalled();
    });
  });

  it('remounts the dynamic meta runner when a tab url switches route meta hooks', async () => {
    mocks.routes.current = buildWorkspaceRoutesWithChangingMetaHooks();
    mocks.setTabs([stableTab('workspace-tab', '/acme')]);

    render(<TabCacheBridges />);

    await waitFor(() => {
      expect(mocks.updateTabCache).toHaveBeenCalledWith(
        'workspace-tab',
        expect.objectContaining({ title: 'Workspace Home' }),
      );
    });

    mocks.updateTabCache.mockClear();
    act(() => {
      mocks.setTabs([stableTab('workspace-tab', '/acme/agent/a1')]);
    });

    await waitFor(() => {
      expect(mocks.updateTabCache).toHaveBeenCalledWith(
        'workspace-tab',
        expect.objectContaining({ title: 'Agent Detail' }),
      );
    });
  });
});
