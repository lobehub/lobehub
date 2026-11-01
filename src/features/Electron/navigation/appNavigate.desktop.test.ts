import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as slugModule from '@/business/client/hooks/useActiveWorkspaceSlug';
import { getOrCreateTabRouter, resetTabRouterManager } from '@/features/Electron/TabHost';

const mocks = vi.hoisted(() => ({
  storeState: { activeTabId: 't1' as string | null, addNewTab: vi.fn() },
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

  it('drops the navigation when the active tab has no live router', () => {
    mocks.storeState.activeTabId = 'missing';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => appNavigate('/agent/x')).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});
