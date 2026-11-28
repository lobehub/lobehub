import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface GlobalStateMock {
  toggleCommandMenu: () => void;
}

const mocks = vi.hoisted(() => ({
  activeWorkspaceSlug: null as string | null,
  enableDashboard: false,
  showMarket: true,
}));

vi.mock('@/config/routes', () => ({
  getRouteById: (id: string) => ({
    icon: () => id,
  }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: GlobalStateMock) => unknown) =>
    selector({ toggleCommandMenu: vi.fn() }),
}));

const ENABLE_DASHBOARD = 'enableDashboard';
vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: 'featureFlags',
  serverConfigSelectors: { enableDashboard: ENABLE_DASHBOARD },
  useServerConfigStore: (selector: unknown) =>
    selector === ENABLE_DASHBOARD
      ? mocks.enableDashboard
      : { hideGitHub: false, showMarket: mocks.showMarket },
}));

vi.mock('@/store/user', () => ({
  useUserStore: () => false,
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableProjects: vi.fn() },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.activeWorkspaceSlug,
}));

describe('useNavLayout', () => {
  beforeEach(() => {
    mocks.activeWorkspaceSlug = null;
    mocks.showMarket = true;
    mocks.enableDashboard = false;
  });

  const dashboardItem = async () => {
    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());
    return result.current.topNavItems.find((item) => item.key === 'dashboard');
  };

  // Boards stay reachable at /dashboard and from widget links; the home
  // sidebar no longer carries an entry for them.
  it.each([null, 'lobe-team'])(
    'keeps Dashboards out of the home sidebar even with the flag on (workspace: %s)',
    async (slug) => {
      mocks.enableDashboard = true;
      mocks.activeWorkspaceSlug = slug as typeof mocks.activeWorkspaceSlug;
      expect(await dashboardItem()).toBeUndefined();
    },
  );

  const goalsItem = async () => {
    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());
    return result.current.topNavItems.find((item) => item.key === 'goals');
  };

  it.each([null, 'acme'])('merges Goals into Tasks (workspace: %s)', async (slug) => {
    mocks.activeWorkspaceSlug = slug as typeof mocks.activeWorkspaceSlug;
    expect(await goalsItem()).toBeUndefined();

    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());
    const tasks = result.current.topNavItems.find((item) => item.key === 'tasks');
    expect(tasks?.additionalActiveTabs).toEqual(['goals', 'goal', 'task']);
  });

  it('keeps Memory visible in personal mode', async () => {
    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());

    const memoryItem = result.current.bottomMenuItems.find((item) => item.key === 'memory');

    expect(memoryItem?.hidden).not.toBe(true);
  });

  it('does not list Pages, which now lives in Docs', async () => {
    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());

    const navKeys = [...result.current.topNavItems, ...result.current.bottomMenuItems].map(
      (item) => item.key,
    );

    expect(navKeys).not.toContain('pages');
    expect(navKeys).toContain('resource');
  });

  it('hides Memory in workspace mode', async () => {
    mocks.activeWorkspaceSlug = 'lobe-team';

    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());

    const memoryItem = result.current.bottomMenuItems.find((item) => item.key === 'memory');

    expect(memoryItem?.hidden).toBe(true);
  });
});
