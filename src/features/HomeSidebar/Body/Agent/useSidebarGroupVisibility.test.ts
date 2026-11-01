/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSidebarGroupVisibility } from './useSidebarGroupVisibility';

const mocks = vi.hoisted(() => ({
  activeWorkspaceId: undefined as string | undefined,
  personalHiddenGroupIds: [] as string[],
  preferenceWorkspaceId: null as string | null,
  updatePreference: vi.fn(),
  updateWorkspaceUserPreference: vi.fn(),
  workspaceHiddenGroupIds: [] as string[],
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) =>
    selector({
      preference: { sidebarHiddenGroupIds: mocks.personalHiddenGroupIds },
      updatePreference: mocks.updatePreference,
      updateWorkspaceUserPreference: mocks.updateWorkspaceUserPreference,
    }),
}));

vi.mock('@/store/user/selectors', () => ({
  workspaceUserSettingsSelectors: {
    preferenceWorkspaceId: () => mocks.preferenceWorkspaceId,
    sidebarHiddenGroupIds: () => mocks.workspaceHiddenGroupIds,
  },
}));

describe('useSidebarGroupVisibility', () => {
  beforeEach(() => {
    mocks.activeWorkspaceId = undefined;
    mocks.personalHiddenGroupIds = [];
    mocks.workspaceHiddenGroupIds = [];
    // Default to "this workspace's row has loaded" so the existing cases
    // exercise the normal path; the gate has its own case below.
    mocks.preferenceWorkspaceId = 'ws_1';
    mocks.updatePreference.mockClear();
    mocks.updateWorkspaceUserPreference.mockClear();
  });

  it('treats a Category as visible unless the caller hid it', () => {
    mocks.activeWorkspaceId = 'ws_1';
    mocks.workspaceHiddenGroupIds = ['grp_hidden'];

    const { result } = renderHook(() => useSidebarGroupVisibility());

    expect(result.current.isSidebarGroupVisible('grp_other_member')).toBe(true);
    expect(result.current.isSidebarGroupVisible('grp_hidden')).toBe(false);
  });

  it('writes the workspace preference bucket in workspace mode', async () => {
    mocks.activeWorkspaceId = 'ws_1';
    mocks.workspaceHiddenGroupIds = ['grp_a'];

    const { result } = renderHook(() => useSidebarGroupVisibility());
    await act(async () => {
      await result.current.setSidebarGroupVisible('grp_b', false);
    });

    expect(mocks.updateWorkspaceUserPreference).toHaveBeenCalledWith({
      sidebarHiddenGroupIds: ['grp_a', 'grp_b'],
    });
    expect(mocks.updatePreference).not.toHaveBeenCalled();
  });

  it('writes the personal preference bucket outside a workspace', async () => {
    mocks.personalHiddenGroupIds = ['grp_a', 'grp_b'];

    const { result } = renderHook(() => useSidebarGroupVisibility());
    await act(async () => {
      await result.current.setSidebarGroupVisible('grp_a', true);
    });

    expect(mocks.updatePreference).toHaveBeenCalledWith({ sidebarHiddenGroupIds: ['grp_b'] });
    expect(mocks.updateWorkspaceUserPreference).not.toHaveBeenCalled();
  });

  it('skips the write when the list is already in the requested shape', async () => {
    mocks.activeWorkspaceId = 'ws_1';
    mocks.workspaceHiddenGroupIds = ['grp_a'];

    const { result } = renderHook(() => useSidebarGroupVisibility());
    await act(async () => {
      await result.current.setSidebarGroupVisible('grp_a', false);
    });

    expect(mocks.updateWorkspaceUserPreference).not.toHaveBeenCalled();
  });

  it("refuses to write before this workspace's preference row has loaded", async () => {
    // The write replaces the whole array, so persisting one built from an
    // empty or previous-workspace value would drop every Category the caller
    // hid earlier. Failing is recoverable; a silent overwrite is not.
    mocks.activeWorkspaceId = 'ws_2';
    mocks.preferenceWorkspaceId = 'ws_1';
    mocks.workspaceHiddenGroupIds = [];

    const { result } = renderHook(() => useSidebarGroupVisibility());

    await expect(result.current.setSidebarGroupVisible('grp_1', false)).rejects.toThrow();
    expect(mocks.updateWorkspaceUserPreference).not.toHaveBeenCalled();
  });
});
