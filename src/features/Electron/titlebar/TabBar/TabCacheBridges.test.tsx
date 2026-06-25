import { cleanup, render, waitFor } from '@testing-library/react';
import { MessageSquare } from 'lucide-react';
import type * as ReactModule from 'react';
import { useState } from 'react';
import type { RouteObject } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import {
  type DynamicRouteMeta,
  type DynamicRouteMetaProps,
  type RouteMeta,
} from '@/spa/router/routeMeta';

import TabCacheBridges from './TabCacheBridges';
import type { TabItem } from './types';

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

const TopicDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  usePublishDynamicRouteMeta(resolveTopicMeta(params), onResolve);

  return null;
};

const agentMeta: RouteMeta = {
  DynamicMeta: TopicDynamicMeta,
  icon: MessageSquare,
  titleKey: 'navigation.chat',
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

const tab = (url: string, id = url): TabItem => ({
  id,
  lastVisited: 1,
  url,
});

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

  it('skips tabs whose route has no DynamicMeta', async () => {
    mocks.routes.current = buildRoutes();
    mocks.setTabs([tab('/settings')]);

    render(<TabCacheBridges />);

    await waitFor(() => {
      expect(mocks.updateTabCache).not.toHaveBeenCalled();
    });
  });

  it('keeps hook order stable when the same tab changes dynamic meta component', async () => {
    const ShorterHookDynamicMeta = ({ onResolve }: DynamicRouteMetaProps) => {
      const [title] = useState('Workspace');

      usePublishDynamicRouteMeta({ title }, onResolve);

      return null;
    };
    const LongerHookDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
      const [agentTitle] = useState(`Agent ${params.aid}`);
      const [topicTitle] = useState('Topic');

      usePublishDynamicRouteMeta({ title: `${agentTitle} · ${topicTitle}` }, onResolve);

      return null;
    };
    const shorterHookMeta: RouteMeta = {
      DynamicMeta: ShorterHookDynamicMeta,
    };
    const longerHookMeta: RouteMeta = {
      DynamicMeta: LongerHookDynamicMeta,
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      mocks.routes.current = [
        {
          children: [
            { handle: { meta: shorterHookMeta }, path: 'workspace' },
            { handle: { meta: longerHookMeta }, path: 'agent/:aid' },
          ],
          path: '/',
        },
      ];
      mocks.setTabs([tab('/workspace', 'tab-1')]);

      const { rerender } = render(<TabCacheBridges />);

      await waitFor(() => {
        expect(mocks.updateTabCache).toHaveBeenLastCalledWith(
          'tab-1',
          expect.objectContaining({ title: 'Workspace' }),
        );
      });

      mocks.updateTabCache.mockClear();
      mocks.setTabs([tab('/agent/a1', 'tab-1')]);
      rerender(<TabCacheBridges />);

      await waitFor(() => {
        expect(mocks.updateTabCache).toHaveBeenLastCalledWith(
          'tab-1',
          expect.objectContaining({ title: 'Agent a1 · Topic' }),
        );
      });

      expect(consoleError.mock.calls.flat().join('\n')).not.toMatch(
        /change in the order of Hooks|Rendered more hooks/,
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
