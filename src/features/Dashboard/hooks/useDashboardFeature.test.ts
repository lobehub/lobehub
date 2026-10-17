import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeWorkspaceSlug: null as string | null,
  enableDashboard: true,
  serverConfigInit: true,
}));

const ENABLE_DASHBOARD = 'enableDashboard';
vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: { enableDashboard: ENABLE_DASHBOARD },
  useServerConfigStore: (selector: unknown) =>
    selector === ENABLE_DASHBOARD
      ? mocks.enableDashboard
      : (selector as (s: { serverConfigInit: boolean }) => unknown)({
          serverConfigInit: mocks.serverConfigInit,
        }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.activeWorkspaceSlug,
}));

describe('useHomeDashboardFeature', () => {
  beforeEach(() => {
    mocks.activeWorkspaceSlug = null;
    mocks.enableDashboard = true;
    mocks.serverConfigInit = true;
  });

  const homeDashboard = async () => {
    const { useHomeDashboardFeature } = await import('./useDashboardFeature');
    return renderHook(() => useHomeDashboardFeature()).result.current;
  };

  it('is on in personal mode while the flag is on', async () => {
    expect(await homeDashboard()).toEqual({ enabled: true, ready: true });
  });

  it('is off while the flag is off', async () => {
    mocks.enableDashboard = false;
    expect(await homeDashboard()).toEqual({ enabled: false, ready: true });
  });

  it('is off inside a workspace even while the flag is on', async () => {
    mocks.activeWorkspaceSlug = 'lobe-team';
    expect(await homeDashboard()).toEqual({ enabled: false, ready: true });
  });

  it('keeps project dashboards on inside a workspace', async () => {
    mocks.activeWorkspaceSlug = 'lobe-team';
    const { useDashboardFeature } = await import('./useDashboardFeature');
    expect(renderHook(() => useDashboardFeature()).result.current.enabled).toBe(true);
  });
});
