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

  it('hides Dashboards while the dashboard feature flag is off', async () => {
    expect((await dashboardItem())?.hidden).toBe(true);
  });

  it('shows Dashboards in personal mode once the flag is on', async () => {
    mocks.enableDashboard = true;
    expect((await dashboardItem())?.hidden).toBe(false);

    mocks.activeWorkspaceSlug = 'lobe-team';
    expect((await dashboardItem())?.hidden).toBe(true);
  });

  const goalsItem = async () => {
    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());
    return result.current.topNavItems.find((item) => item.key === 'goals');
  };

  it('merges Goals into Tasks in personal mode and keeps both workspace destinations', async () => {
    expect(await goalsItem()).toBeUndefined();
    mocks.activeWorkspaceSlug = 'acme';
    const item = await goalsItem();
    expect(item?.hidden).not.toBe(true);
    expect(item?.url).toBe('/goals');

    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());
    const keys = result.current.topNavItems.map((navItem) => navItem.key);
    expect(keys.indexOf('goals')).toBe(keys.indexOf('tasks') + 1);
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
