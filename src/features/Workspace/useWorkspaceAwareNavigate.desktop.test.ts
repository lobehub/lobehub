import { ModalHost } from '@lobehub/ui/base-ui';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as slugModule from '@/business/client/hooks/useActiveWorkspaceSlug';
import {
  getOrCreateTabRouter,
  resetTabRouterManager,
  TabIdContext,
} from '@/features/Electron/TabHost';

const mocks = vi.hoisted(() => ({
  shareDevice: vi.fn().mockResolvedValue({ success: true }),
  storeState: { activeTabId: 'tA' as string | null, addNewTab: vi.fn() },
}));

vi.mock('@/business/client/hooks/useWorkspaces', () => ({
  useWorkspaces: () => [{ id: 'workspace-target', name: 'Target', role: 'member', slug: 'target' }],
}));

vi.mock('@/libs/trpc/client', () => ({
  createWorkspaceLambdaClient: () => ({
    device: { shareDeviceToWorkspace: { mutate: mocks.shareDevice } },
  }),
}));

vi.mock('@/features/DeviceManager/const', () => ({ refreshDeviceList: vi.fn() }));

// NOTICE:
// Exercise the same platform module replacement as the Electron renderer.
// Vitest otherwise resolves the Web hook used by the shared modal.
// Source: useWorkspaceAwareNavigate.desktop.ts and the Vite platform resolver.
// Remove when this test project resolves desktop twins automatically.
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () =>
  vi.importActual('@/features/Workspace/useWorkspaceAwareNavigate.desktop'),
);

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
  cleanup();
  resetTabRouterManager();
  vi.restoreAllMocks();
  mocks.storeState.activeTabId = 'tA';
  mocks.storeState.addNewTab = vi.fn();
});

describe('useWorkspaceAwareNavigate (desktop)', () => {
  /** @example Sharing from personal settings opens the destination in the visible tab. */
  it('navigates the active tab from the globally hosted device-share completion', async () => {
    // ROOT CAUSE:
    // The share modal is rendered by the global ModalHost outside the tab router.
    // Its raw useNavigate updated the root router, leaving the visible tab unchanged.
    // The workspace-aware desktop hook instead resolves the active tab router.
    const { openShareDeviceModal } = await import('@/features/DeviceManager/ShareDeviceModal');
    vi.spyOn(slugModule, 'getActiveWorkspaceSlug').mockReturnValue('source');
    const tabRouter = getOrCreateTabRouter('tA', '/settings/devices', makeRouter);
    const rootRouter = createMemoryRouter([{ element: createElement(ModalHost), path: '*' }], {
      initialEntries: ['/'],
    });
    render(createElement(RouterProvider, { router: rootRouter }));

    act(() => {
      openShareDeviceModal({
        channels: [],
        defaultCwd: null,
        deviceId: 'local-device',
        enroller: null,
        friendlyName: null,
        hostname: 'Local Mac',
        identitySource: 'machine-id',
        lastSeen: new Date(0).toISOString(),
        online: true,
        platform: 'darwin',
        registered: true,
        scope: 'personal',
        visibility: null,
        workingDirs: [],
      });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'devices.share.confirm' }));
    fireEvent.click(await screen.findByRole('button', { name: 'devices.share.goToTarget' }));

    /** @example The tab reaches /target/settings/devices while the root stays frozen. */
    await waitFor(() => expect(tabRouter.state.location.pathname).toBe('/target/settings/devices'));
    expect(rootRouter.state.location.pathname).toBe('/');
    /** @example The success modal closes after navigation. */
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    rootRouter.dispose();
  });

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
