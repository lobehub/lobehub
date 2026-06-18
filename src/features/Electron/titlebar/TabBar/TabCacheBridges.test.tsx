import { cleanup, render, waitFor } from '@testing-library/react';
import { MessageSquare } from 'lucide-react';
import { type RouteObject } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type DynamicRouteMeta, type RouteMeta } from '@/spa/router/routeMeta';

import TabCacheBridges from './TabCacheBridges';
import { type TabItem } from './types';

const mocks = vi.hoisted(() => {
  const tabs: { current: { id: string; lastVisited: number; url: string }[] } = { current: [] };

  return {
    getTabs: () => tabs.current,
    routes: { current: [] as RouteObject[] },
    setRoutes: (next: RouteObject[]) => {
      tabs.current = [];
      mocks.routes.current = next;
    },
    setTabs: (next: { id: string; lastVisited: number; url: string }[]) => {
      tabs.current = next;
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

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: ElectronState) => unknown) =>
    selector({ tabs: mocks.getTabs(), updateTabCache: mocks.updateTabCache }),
}));

const dynamicSource: Record<string, DynamicRouteMeta> = {};
const resolveTopicMeta = (params: Record<string, string | undefined>): DynamicRouteMeta => {
  const key = params.topicId ?? '';
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

const tab = (url: string): TabItem => ({ id: url, lastVisited: 1, url });

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
    dynamicSource['topic-A'] = { title: 'Topic A' };
    dynamicSource['topic-B'] = { title: 'Topic B' };

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

  it('skips tabs whose route has no useDynamicMeta', async () => {
    mocks.routes.current = buildRoutes();
    mocks.setTabs([tab('/settings')]);

    render(<TabCacheBridges />);

    await waitFor(() => {
      expect(mocks.updateTabCache).not.toHaveBeenCalled();
    });
  });
});
