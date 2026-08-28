import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as slugModule from '@/business/client/hooks/useActiveWorkspaceSlug';
import {
  getOrCreateTabRouter,
  resetTabRouterManager,
  TabIdContext,
} from '@/features/Electron/TabHost';

const mocks = vi.hoisted(() => ({
  storeState: { activeTabId: 'tA' as string | null, addNewTab: vi.fn() },
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(mocks.storeState),
    { getState: () => mocks.storeState },
  ),
}));

// Mirror platformResolve: the electron build rewrites the base appNavigate
// import inside the desktop twin to the .desktop implementation.
vi.mock('@/features/Electron/navigation/appNavigate', () =>
  vi.importActual('@/features/Electron/navigation/appNavigate.desktop'),
);

const { useWorkspaceAwareNavigate } = await import('./useWorkspaceAwareNavigate.desktop');

const makeRouter = (url: string) =>
  createMemoryRouter([{ element: null, path: '*' }], { initialEntries: [url] });

const seedRouter = (tabId: string) => {
  const router = getOrCreateTabRouter(tabId, '/', makeRouter);
  return vi.spyOn(router, 'navigate').mockResolvedValue(undefined);
};

const renderNavigate = (tabId?: string) =>
  renderHook(() => useWorkspaceAwareNavigate(), {
    wrapper: tabId
      ? ({ children }: { children: ReactNode }) =>
          createElement(TabIdContext, { value: tabId }, children)
      : undefined,
  }).result.current;

afterEach(() => {
  resetTabRouterManager();
  vi.restoreAllMocks();
  mocks.storeState.activeTabId = 'tA';
  mocks.storeState.addNewTab = vi.fn();
});

describe('useWorkspaceAwareNavigate (desktop)', () => {
  it('shell (no tab context): navigates the active tab with the workspace-resolved url', () => {
    vi.spyOn(slugModule, 'getActiveWorkspaceSlug').mockReturnValue('acme');
    const navigateA = seedRouter('tA');

    renderNavigate()('/agent/x');

    expect(navigateA).toHaveBeenCalledWith('/acme/agent/x', {});
  });

  it('content: navigates the originating tab with the workspace-resolved url', () => {
    vi.spyOn(slugModule, 'getActiveWorkspaceSlug').mockReturnValue('acme');
    const navigateA = seedRouter('tA');

    renderNavigate('tA')('/agent/x');

    expect(navigateA).toHaveBeenCalledWith('/acme/agent/x', {});
  });

  it('content: escape skips workspace resolution', () => {
    vi.spyOn(slugModule, 'getActiveWorkspaceSlug').mockReturnValue('acme');
    const navigateA = seedRouter('tA');

    renderNavigate('tA')('/agent/x', { escape: true });

    expect(navigateA).toHaveBeenCalledWith('/agent/x', {});
  });

  it('content: a captured navigate still targets the originating tab after the active tab switches', () => {
    const navigateA = seedRouter('tA');
    const navigateB = seedRouter('tB');
    const navigate = renderNavigate('tA');

    mocks.storeState.activeTabId = 'tB';
    navigate('/agent/x');

    expect(navigateA).toHaveBeenCalledWith('/agent/x', {});
    expect(navigateB).not.toHaveBeenCalled();
  });

  it('content: object form targets the originating tab, not the active one', () => {
    const navigateA = seedRouter('tA');
    const navigateB = seedRouter('tB');
    mocks.storeState.activeTabId = 'tB';

    renderNavigate('tA')({ pathname: '/settings' }, { replace: true });

    expect(navigateA).toHaveBeenCalledWith({ pathname: '/settings' }, { replace: true });
    expect(navigateB).not.toHaveBeenCalled();
  });

  it('content: delta form targets the originating tab, not the active one', () => {
    const navigateA = seedRouter('tA');
    const navigateB = seedRouter('tB');
    mocks.storeState.activeTabId = 'tB';

    renderNavigate('tA')(-1);

    expect(navigateA).toHaveBeenCalledWith(-1);
    expect(navigateB).not.toHaveBeenCalled();
  });

  it('content: drops the navigation when the originating tab router was disposed', () => {
    const navigateA = seedRouter('tA');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => renderNavigate('tGone')('/agent/x')).not.toThrow();

    expect(warn).toHaveBeenCalled();
    expect(navigateA).not.toHaveBeenCalled();
  });
});
