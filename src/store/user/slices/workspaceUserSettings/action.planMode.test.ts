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
    setHeteroPlanModeDir: vi.fn(),
    updatePreference: vi.fn(),
  },
}));

vi.mock('@/services/user', async (importOriginal) => {
  const original = await importOriginal<{ userService: object }>();
  return {
    ...original,
    userService: { ...original.userService, setHeteroPlanModeDir: vi.fn() },
  };
});

const state = () => useUserStore.getState();

const seed = (preference: WorkspaceUserPreference) =>
  useUserStore.setState({
    workspaceUserPreference: preference,
    workspaceUserPreferenceWorkspaceId: 'workspace-1',
  });

describe('setHeteroPlanModeDir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    active.id = 'workspace-1';
    useUserStore.setState({
      preference: { heteroPlanModeDirs: ['dev::/p'] } as any,
      workspaceUserPreference: {},
      workspaceUserPreferenceWorkspaceId: null,
    });
  });

  it('remembers the switch in the workspace bucket, beside the worktree switch', async () => {
    seed({ worktreeModeDirs: ['dev::/a'] });
    vi.mocked(workspaceUserSettingsService.setHeteroPlanModeDir).mockResolvedValue(['dev::/a']);

    await act(() => state().setHeteroPlanModeDir('dev::/a', true));

    expect(workspaceUserSettingsService.setHeteroPlanModeDir).toHaveBeenCalledWith('dev::/a', true);
    expect(state().workspaceUserPreference).toMatchObject({
      heteroPlanModeDirs: ['dev::/a'],
      worktreeModeDirs: ['dev::/a'],
    });
    // The personal bucket is a different person-context and stays untouched.
    expect(state().preference.heteroPlanModeDirs).toEqual(['dev::/p']);
  });

  it('writes users.preference in personal mode and rolls back a failed write', async () => {
    active.id = null;
    vi.mocked(userService.setHeteroPlanModeDir).mockRejectedValue(new Error('offline'));

    await expect(act(() => state().setHeteroPlanModeDir('dev::/p', false))).rejects.toThrow(
      'offline',
    );
    expect(state().preference.heteroPlanModeDirs).toEqual(['dev::/p']);

    vi.mocked(userService.setHeteroPlanModeDir).mockResolvedValue([]);
    await act(() => state().setHeteroPlanModeDir('dev::/p', false));
    expect(state().preference.heteroPlanModeDirs).toEqual([]);
  });
});
