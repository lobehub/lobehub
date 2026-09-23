import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface GlobalStateMock {
  toggleCommandMenu: () => void;
}

const mocks = vi.hoisted(() => ({
  activeWorkspaceSlug: null as string | null,
  showMarket: true,
  enableQuickNote: false,
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

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: {},
  useServerConfigStore: () => ({
    hideGitHub: false,
    enableQuickNote: mocks.enableQuickNote,
    showMarket: mocks.showMarket,
  }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.activeWorkspaceSlug,
}));

describe('useNavLayout', () => {
  beforeEach(() => {
    mocks.activeWorkspaceSlug = null;
    mocks.showMarket = true;
    mocks.enableQuickNote = false;
  });

  it('keeps Memory visible in personal mode', async () => {
    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());

    const memoryItem = result.current.bottomMenuItems.find((item) => item.key === 'memory');

    expect(memoryItem?.hidden).not.toBe(true);
  });

  it('hides Memory in workspace mode', async () => {
    mocks.activeWorkspaceSlug = 'lobe-team';

    const { useNavLayout } = await import('./useNavLayout');
    const { result } = renderHook(() => useNavLayout());

    const memoryItem = result.current.bottomMenuItems.find((item) => item.key === 'memory');

    expect(memoryItem?.hidden).toBe(true);
  });
  /** @example Quick Note appears only after the server grants rollout access. */
  it('updates the Note entry when rollout access changes', async () => {
    const { useNavLayout } = await import('./useNavLayout');
    const { result, rerender } = renderHook(() => useNavLayout());
    /** @example Disabled users cannot see the note navigation entry. */
    expect(result.current.topNavItems.find((item) => item.key === 'note')?.hidden).toBe(true);
    mocks.enableQuickNote = true;
    rerender();
    /** @example Enabling the flag reveals the same navigation entry. */
    expect(result.current.topNavItems.find((item) => item.key === 'note')?.hidden).toBe(false);
  });
});
