import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';

import { useSyncWorkspaceSidebarPreference } from './useSyncWorkspaceSidebarPreference';

// Route `updateSystemStatus` writes into the workspace overlay, as on cloud
// where the user is inside a workspace (the OSS stub returns null).
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => 'ws-b',
  useActiveWorkspaceId: () => 'ws-b',
}));

const setOverlay = (overlay: Record<string, unknown> | undefined) => {
  useGlobalStore.setState((s) => ({
    isStatusInit: true,
    status: { ...s.status, workspace: overlay as never },
  }));
};

describe('useSyncWorkspaceSidebarPreference', () => {
  beforeEach(() => {
    setOverlay(undefined);
    useUserStore.setState({
      workspaceUserPreference: {},
      workspaceUserPreferenceWorkspaceId: null,
    });
  });

  it('clears a previous workspace overlay when the loaded preference has no sidebar', () => {
    // Overlay still holds workspace A's layout…
    setOverlay({ hiddenSidebarSections: ['recents'], sidebarItems: ['agents'] });
    // …while workspace B's preference row has loaded with no sidebar value.
    useUserStore.setState({
      workspaceUserPreference: {},
      workspaceUserPreferenceWorkspaceId: 'ws-b',
    });

    renderHook(() => useSyncWorkspaceSidebarPreference('ws-b'));

    const workspace = useGlobalStore.getState().status.workspace;
    expect(workspace?.sidebarItems).toBeUndefined();
    expect(workspace?.hiddenSidebarSections).toBeUndefined();
  });

  it('keeps the overlay while the active workspace preference has not loaded yet', () => {
    setOverlay({ sidebarItems: ['agents'] });
    // Bucket still belongs to the previously visited workspace.
    useUserStore.setState({
      workspaceUserPreference: {},
      workspaceUserPreferenceWorkspaceId: 'ws-a',
    });

    renderHook(() => useSyncWorkspaceSidebarPreference('ws-b'));

    expect(useGlobalStore.getState().status.workspace?.sidebarItems).toEqual(['agents']);
  });

  it('deletes overlay fields the loaded server sidebar does not carry', () => {
    // Workspace A left a custom item order; workspace B only hides sections.
    setOverlay({ sidebarItems: ['agents'] });
    useUserStore.setState({
      workspaceUserPreference: { sidebar: { hiddenSections: ['recents'] } },
      workspaceUserPreferenceWorkspaceId: 'ws-b',
    });

    renderHook(() => useSyncWorkspaceSidebarPreference('ws-b'));

    const workspace = useGlobalStore.getState().status.workspace;
    expect(workspace?.hiddenSidebarSections).toEqual(['recents']);
    expect(workspace?.sidebarItems).toBeUndefined();
  });

  it('pulls the loaded server sidebar layout onto the overlay', () => {
    setOverlay({ sidebarItems: ['agents'] });
    useUserStore.setState({
      workspaceUserPreference: {
        sidebar: { hiddenSections: ['recents'], items: ['projects', 'agents'] },
      },
      workspaceUserPreferenceWorkspaceId: 'ws-b',
    });

    renderHook(() => useSyncWorkspaceSidebarPreference('ws-b'));

    const workspace = useGlobalStore.getState().status.workspace;
    expect(workspace?.sidebarItems).toEqual(['projects', 'agents']);
    expect(workspace?.hiddenSidebarSections).toEqual(['recents']);
  });
});
