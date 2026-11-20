import type { WorkspaceUserPreference } from '@lobechat/types';
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { userService } from '@/services/user';
import { workspaceUserSettingsService } from '@/services/workspaceUserSettings';
import { useUserStore } from '@/store/user';

const active = vi.hoisted(() => ({ id: 'workspace-1' as string | null }));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => active.id,
  useActiveWorkspaceId: () => active.id,
}));

vi.mock('@/services/workspaceUserSettings', () => ({
  workspaceUserSettingsService: {
    getPreference: vi.fn(),
    setHeteroPermissionModeDir: vi.fn(),
    updatePreference: vi.fn(),
  },
}));

vi.mock('@/services/user', async (importOriginal) => {
  const original = await importOriginal<{ userService: object }>();
  return {
    ...original,
    userService: { ...original.userService, setHeteroPermissionModeDir: vi.fn() },
  };
});

const state = () => useUserStore.getState();

const seed = (preference: WorkspaceUserPreference) =>
  useUserStore.setState({
    workspaceUserPreference: preference,
    workspaceUserPreferenceWorkspaceId: 'workspace-1',
  });

describe('setHeteroPermissionModeDir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    active.id = 'workspace-1';
    useUserStore.setState({
      preference: { heteroPermissionModeDirs: [{ key: 'dev::/p', mode: 'plan' }] } as any,
      workspaceUserPreference: {},
      workspaceUserPreferenceWorkspaceId: null,
    });
  });

  it('remembers the mode in the workspace bucket, beside the worktree switch', async () => {
    seed({ worktreeModeDirs: ['dev::/a'] });
    vi.mocked(workspaceUserSettingsService.setHeteroPermissionModeDir).mockResolvedValue([
      { key: 'dev::/a', mode: 'acceptEdits' },
    ]);

    await act(() => state().setHeteroPermissionModeDir('dev::/a', 'acceptEdits'));

    expect(workspaceUserSettingsService.setHeteroPermissionModeDir).toHaveBeenCalledWith(
      'dev::/a',
      'acceptEdits',
    );
    expect(state().workspaceUserPreference).toMatchObject({
      heteroPermissionModeDirs: [{ key: 'dev::/a', mode: 'acceptEdits' }],
      worktreeModeDirs: ['dev::/a'],
    });
    expect(state().preference.heteroPermissionModeDirs).toEqual([{ key: 'dev::/p', mode: 'plan' }]);
  });

  it('writes users.preference in personal mode and rolls back a failed write', async () => {
    active.id = null;
    vi.mocked(userService.setHeteroPermissionModeDir).mockRejectedValue(new Error('offline'));

    await expect(
      act(() => state().setHeteroPermissionModeDir('dev::/p', 'default')),
    ).rejects.toThrow('offline');
    expect(state().preference.heteroPermissionModeDirs).toEqual([{ key: 'dev::/p', mode: 'plan' }]);

    vi.mocked(userService.setHeteroPermissionModeDir).mockResolvedValue([
      { key: 'dev::/p', mode: 'default' },
    ]);
    await act(() => state().setHeteroPermissionModeDir('dev::/p', 'default'));
    expect(state().preference.heteroPermissionModeDirs).toEqual([
      { key: 'dev::/p', mode: 'default' },
    ]);
  });
});
