import type { ProjectionHydrationRequest } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { homeRoutePrefetch } from '@/features/Home/routePrefetch';
import { registerProjectionPersistence } from '@/projection/registry';
import { useProjectionStore } from '@/projection/store';
import { agentRoutePrefetch } from '@/routes/(main)/agent/features/routePrefetch';

import { prefetchRouteProjection, prefetchShellProjection } from './prefetchProjection';

const SCOPE = 'user-1:personal';

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => SCOPE,
  isAnonymousScope: (scope: string) => scope.startsWith('anon:'),
  isScopeTrusted: () => true,
}));

describe('boot Projection prefetch', () => {
  afterEach(() => {
    useProjectionStore.setState({ scopes: {} });
    vi.restoreAllMocks();
  });

  it('reads the Home sidebar from the local cache without waiting for a mounted surface', async () => {
    const requests: ProjectionHydrationRequest[] = [];
    const restore = registerProjectionPersistence({
      clearScope: async () => {},
      commit: async () => {},
      hydrate: async (_scope, request) => {
        requests.push(request);
        return { indexes: [], records: [], snapshots: [] };
      },
    });

    await prefetchShellProjection();
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    expect(requests[0].indexes).toEqual(['home.sidebar']);
    restore();
  });

  it('warms the landing route behind the shell, and only that route', async () => {
    const started: string[] = [];
    let releaseSidebar!: () => void;
    const sidebarMayFinish = new Promise<void>((resolve) => {
      releaseSidebar = resolve;
    });
    const restore = registerProjectionPersistence({
      clearScope: async () => {},
      commit: async () => {},
      hydrate: async (_scope, request) => {
        const key = request.indexes?.[0] ?? 'records';
        started.push(key);
        if (key === 'home.sidebar') await sidebarMayFinish;
        return { indexes: [], records: [], snapshots: [] };
      },
    });

    prefetchRouteProjection(
      [
        { handle: { prefetch: homeRoutePrefetch }, path: '/' },
        { handle: { prefetch: agentRoutePrefetch }, path: '/agent/:aid' },
      ],
      '/agent/agent-1',
    );
    await vi.waitFor(() => expect(started).toEqual(['home.sidebar']));

    releaseSidebar();
    await vi.waitFor(() => expect(started).toHaveLength(2));
    expect(started).toEqual(['home.sidebar', 'records']);
    restore();
  });

  it('skips a route that declares nothing', () => {
    const hydrate = vi.fn();
    const restore = registerProjectionPersistence({
      clearScope: async () => {},
      commit: async () => {},
      hydrate,
    });

    prefetchRouteProjection([{ path: '/settings' }], '/settings');

    expect(hydrate).not.toHaveBeenCalled();
    restore();
  });
});
