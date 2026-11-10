import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface GlobalStateMock {
  toggleCommandMenu: () => void;
}

const mocks = vi.hoisted(() => ({
  activeWorkspaceSlug: null as string | null,
  enableDashboard: false,
  enableGoals: false,
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

const ENABLE_GOALS = 'enableGoals';
vi.mock('@/store/user', () => ({
  useUserStore: (selector: unknown) => (selector === ENABLE_GOALS ? mocks.enableGoals : undefined),
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableGoals: ENABLE_GOALS },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.activeWorkspaceSlug,
}));

describe('useNavLayout', () => {
  beforeEach(() => {
    mocks.activeWorkspaceSlug = null;
    mocks.showMarket = true;
    mocks.enableDashboard = false;
    mocks.enableGoals = false;
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

  it('hides Goals while the goals lab is off', async () => {
    expect((await goalsItem())?.hidden).toBe(true);
  });

  it('shows Goals next to Tasks once the goals lab is on', async () => {
    mocks.enableGoals = true;
    const item = await goalsItem();
    expect(item?.hidden).toBe(false);
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
