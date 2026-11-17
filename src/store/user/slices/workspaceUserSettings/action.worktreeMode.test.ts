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
    setWorktreeModeDir: vi.fn(),
    updatePreference: vi.fn(),
  },
}));

vi.mock('@/services/user', async (importOriginal) => {
  const original = await importOriginal<{ userService: object }>();
  return { ...original, userService: { ...original.userService, setWorktreeModeDir: vi.fn() } };
});

const state = () => useUserStore.getState();

const seed = (preference: WorkspaceUserPreference) =>
  useUserStore.setState({
    workspaceUserPreference: preference,
    workspaceUserPreferenceWorkspaceId: 'workspace-1',
  });

describe('setWorktreeModeDir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    active.id = 'workspace-1';
    useUserStore.setState({
      preference: { worktreeModeDirs: ['dev::/personal'] } as any,
      workspaceUserPreference: {},
      workspaceUserPreferenceWorkspaceId: null,
    });
  });

  it('writes the workspace bucket inside a workspace and leaves the personal list alone', async () => {
    seed({ agentModeOverrides: { a: true }, worktreeModeDirs: ['dev::/old'] });
    vi.mocked(workspaceUserSettingsService.setWorktreeModeDir).mockResolvedValue([
      'dev::/new',
      'dev::/old',
    ]);

    await act(() => state().setWorktreeModeDir('dev::/new', true));

    expect(workspaceUserSettingsService.setWorktreeModeDir).toHaveBeenCalledWith('dev::/new', true);
    expect(state().workspaceUserPreference).toMatchObject({
      agentModeOverrides: { a: true },
      worktreeModeDirs: ['dev::/new', 'dev::/old'],
    });
    expect(state().preference.worktreeModeDirs).toEqual(['dev::/personal']);
    expect(userService.setWorktreeModeDir).not.toHaveBeenCalled();
  });

  it('rolls the workspace bucket back and rethrows when the write fails', async () => {
    seed({ worktreeModeDirs: ['dev::/old'] });
    vi.mocked(workspaceUserSettingsService.setWorktreeModeDir).mockRejectedValue(new Error('down'));

    await expect(state().setWorktreeModeDir('dev::/old', false)).rejects.toThrow('down');
    expect(state().workspaceUserPreference.worktreeModeDirs).toEqual(['dev::/old']);
  });

  it('writes users.preference in personal mode', async () => {
    active.id = null;
    vi.mocked(userService.setWorktreeModeDir).mockResolvedValue(['dev::/a', 'dev::/personal']);

    await act(() => state().setWorktreeModeDir('dev::/a', true));

    expect(userService.setWorktreeModeDir).toHaveBeenCalledWith('dev::/a', true);
    expect(state().preference.worktreeModeDirs).toEqual(['dev::/a', 'dev::/personal']);
    expect(workspaceUserSettingsService.setWorktreeModeDir).not.toHaveBeenCalled();
  });

  it('rolls the personal list back and rethrows when the write fails', async () => {
    active.id = null;
    vi.mocked(userService.setWorktreeModeDir).mockRejectedValue(new Error('down'));

    await expect(state().setWorktreeModeDir('dev::/a', true)).rejects.toThrow('down');
    expect(state().preference.worktreeModeDirs).toEqual(['dev::/personal']);
  });
});
