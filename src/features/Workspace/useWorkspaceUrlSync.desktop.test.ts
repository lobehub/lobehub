import { act, renderHook } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as useActiveWorkspaceIdModule from '@/business/client/hooks/useActiveWorkspaceId';
import * as useIsWorkspaceLoadingModule from '@/business/client/hooks/useIsWorkspaceLoading';
import * as useSwitchWorkspaceModule from '@/business/client/hooks/useSwitchWorkspace';
import * as useWorkspacesModule from '@/business/client/hooks/useWorkspaces';
import { useElectronStore } from '@/store/electron';
import { initialState } from '@/store/electron/initialState';

import { useWorkspaceSyncPathname } from './useWorkspaceSyncPathname.desktop';
import { useWorkspaceUrlSync } from './useWorkspaceUrlSync';

vi.mock(
  './useWorkspaceSyncPathname',
  async () => await import('./useWorkspaceSyncPathname.desktop'),
);

const switchWorkspace = vi.fn();
const switchToPersonal = vi.fn();

// The shell router is frozen at the boot url; every assertion below relies on
// the hook ignoring it in favour of the active tab.
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(MemoryRouter, { initialEntries: ['/'] }, children);

const setTabs = (tabs: { id: string; url: string }[], activeTabId: null | string) => {
  useElectronStore.setState({
    ...initialState,
    activeTabId,
    tabs: tabs.map((tab, index) => ({ ...tab, lastVisited: index })),
  });
};

beforeEach(() => {
  vi.spyOn(useWorkspacesModule, 'useWorkspaces').mockReturnValue([
    { id: 'ws-1', slug: 'acme' },
  ] as any);
  vi.spyOn(useIsWorkspaceLoadingModule, 'useIsWorkspaceLoading').mockReturnValue(false);
  vi.spyOn(useActiveWorkspaceIdModule, 'useActiveWorkspaceId').mockReturnValue(null);
  vi.spyOn(useSwitchWorkspaceModule, 'useSilentSwitchWorkspace').mockReturnValue({
    switchToPersonal,
    switchWorkspace,
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  switchWorkspace.mockClear();
  switchToPersonal.mockClear();
  window.history.replaceState(null, '', '/');
});

describe('useWorkspaceSyncPathname (desktop)', () => {
  it('reads the active tab pathname without its query or anchor', () => {
    setTabs([{ id: 'a', url: '/acme/agent/x?q=1#msg_1' }], 'a');

    const { result } = renderHook(() => useWorkspaceSyncPathname(), { wrapper });

    expect(result.current).toBe('/acme/agent/x');
  });

  it('follows tab switches instead of the frozen shell router', () => {
    setTabs(
      [
        { id: 'a', url: '/acme/agent/x' },
        { id: 'b', url: '/agent/y' },
      ],
      'a',
    );

    const { result } = renderHook(() => useWorkspaceSyncPathname(), { wrapper });
    expect(result.current).toBe('/acme/agent/x');

    act(() => {
      useElectronStore.setState({ activeTabId: 'b' });
    });

    expect(result.current).toBe('/agent/y');
  });

  it('falls back to the window url before the tab list is seeded', () => {
    window.history.replaceState(null, '', '/acme/agent/boot');
    setTabs([], null);

    const { result } = renderHook(() => useWorkspaceSyncPathname(), { wrapper });

    expect(result.current).toBe('/acme/agent/boot');
  });
});

describe('useWorkspaceUrlSync (desktop)', () => {
  it('activates the workspace of the active tab, not the boot location', () => {
    setTabs([{ id: 'a', url: '/acme/agent/x' }], 'a');

    renderHook(() => useWorkspaceUrlSync(), { wrapper });

    expect(switchWorkspace).toHaveBeenCalledWith('ws-1');
  });

  it('returns to personal context when the user switches to a personal tab', () => {
    vi.spyOn(useActiveWorkspaceIdModule, 'useActiveWorkspaceId').mockReturnValue('ws-1');
    setTabs(
      [
        { id: 'a', url: '/acme/agent/x' },
        { id: 'b', url: '/agent/y' },
      ],
      'a',
    );

    renderHook(() => useWorkspaceUrlSync(), { wrapper });
    expect(switchToPersonal).not.toHaveBeenCalled();

    act(() => {
      useElectronStore.setState({ activeTabId: 'b' });
    });

    expect(switchToPersonal).toHaveBeenCalled();
  });
});
