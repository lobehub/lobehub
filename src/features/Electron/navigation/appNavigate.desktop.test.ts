import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as slugModule from '@/business/client/hooks/useActiveWorkspaceSlug';
import { getOrCreateTabRouter, resetTabRouterManager } from '@/features/Electron/TabHost';

const mocks = vi.hoisted(() => ({
  storeState: {
    activateTab: vi.fn(),
    activeTabId: 't1' as string | null,
    addNewTab: vi.fn(),
    tabs: [] as { id: string; url: string }[],
  },
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(mocks.storeState),
    { getState: () => mocks.storeState },
  ),
}));

const { appNavigate } = await import('./appNavigate.desktop');

const makeRouter = (url: string) =>
  createMemoryRouter([{ element: null, path: '*' }], { initialEntries: [url] });

const seedActiveRouter = () => {
  const router = getOrCreateTabRouter('t1', '/', makeRouter);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(undefined);
  return navigate;
};

afterEach(() => {
  resetTabRouterManager();
  vi.restoreAllMocks();
  mocks.storeState.activeTabId = 't1';
  mocks.storeState.addNewTab = vi.fn();
  mocks.storeState.activateTab = vi.fn();
  mocks.storeState.tabs = [];
});

describe('appNavigate (desktop)', () => {
  it('navigates the active tab router with the workspace-resolved url', () => {
    vi.spyOn(slugModule, 'getActiveWorkspaceSlug').mockReturnValue('acme');
    const navigate = seedActiveRouter();

    appNavigate('/agent/x');

    expect(navigate).toHaveBeenCalledWith('/acme/agent/x', {});
  });

  it('skips workspace resolution when escape is set', () => {
    vi.spyOn(slugModule, 'getActiveWorkspaceSlug').mockReturnValue('acme');
    const navigate = seedActiveRouter();

    appNavigate('/agent/x', { escape: true });

    expect(navigate).toHaveBeenCalledWith('/agent/x', {});
  });

  it('forwards react-router options (replace) to the active tab router', () => {
    const navigate = seedActiveRouter();

    appNavigate('/settings', { replace: true });

    expect(navigate).toHaveBeenCalledWith('/settings', { replace: true });
  });

  it('opens a new tab via the store without navigating any router', () => {
    vi.spyOn(slugModule, 'getActiveWorkspaceSlug').mockReturnValue('acme');
    const navigate = seedActiveRouter();

    appNavigate('/group/y', { target: 'newTab' });

    expect(mocks.storeState.addNewTab).toHaveBeenCalledWith('/acme/group/y');
    expect(navigate).not.toHaveBeenCalled();
  });

  describe('existingTab target', () => {
    it('activates the tab already showing the url instead of rewriting the active tab', () => {
      // Tab A runs the conversation in the background while tab B (t1) is focused.
      mocks.storeState.tabs = [
        { id: 'tA', url: '/agent/a1/tpc_1' },
        { id: 't1', url: '/agent/b1/tpc_2' },
      ];
      const navigate = seedActiveRouter();

      appNavigate('/agent/a1/tpc_1', { escape: true, target: 'existingTab' });

      expect(mocks.storeState.activateTab).toHaveBeenCalledWith('tA');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('matches tabs with the same normalization as the tab store (trailing slash, hash)', () => {
      mocks.storeState.tabs = [{ id: 'tA', url: '/team/agent/a1/tpc_1/#latest' }];
      const navigate = seedActiveRouter();

      appNavigate('/team/agent/a1/tpc_1', { escape: true, target: 'existingTab' });

      expect(mocks.storeState.activateTab).toHaveBeenCalledWith('tA');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('falls back to navigating the active tab when no tab shows the url', () => {
      mocks.storeState.tabs = [{ id: 't1', url: '/agent/b1/tpc_2' }];
      const navigate = seedActiveRouter();

      appNavigate('/agent/a1/tpc_1', { escape: true, target: 'existingTab' });

      expect(mocks.storeState.activateTab).not.toHaveBeenCalled();
      expect(mocks.storeState.addNewTab).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith('/agent/a1/tpc_1', {});
    });

    it('matches against the workspace-resolved url when escape is not set', () => {
      vi.spyOn(slugModule, 'getActiveWorkspaceSlug').mockReturnValue('acme');
      mocks.storeState.tabs = [
        { id: 'personal', url: '/agent/a1' },
        { id: 'tA', url: '/acme/agent/a1' },
      ];
      seedActiveRouter();

      appNavigate('/agent/a1', { target: 'existingTab' });

      expect(mocks.storeState.activateTab).toHaveBeenCalledWith('tA');
    });
  });

  it('drops the navigation when the active tab has no live router', () => {
    mocks.storeState.activeTabId = 'missing';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => appNavigate('/agent/x')).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});
