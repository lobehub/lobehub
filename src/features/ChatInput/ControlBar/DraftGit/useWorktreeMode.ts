import { getWorktreeModeKey } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getActiveWorkspaceId,
  useActiveWorkspaceId,
} from '@/business/client/hooks/useActiveWorkspaceId';
import { getUserStoreState, useUserStore } from '@/store/user';
import type { UserState } from '@/store/user/initialState';

/**
 * The stored "New worktree" directories of whoever is acting now: this member's
 * workspace bucket inside a workspace, `users.preference` in personal mode.
 * `undefined` while the workspace bucket has not loaded — not "all off".
 */
const selectWorktreeModeDirs =
  (workspaceId: string | null | undefined) =>
  (state: UserState): string[] | undefined => {
    if (!workspaceId) return state.preference.worktreeModeDirs ?? [];
    return state.workspaceUserPreferenceWorkspaceId === workspaceId
      ? (state.workspaceUserPreference.worktreeModeDirs ?? [])
      : undefined;
  };

/** Whether the switch is on for `key`, read at send time. Unknown reads as off. */
export const isWorktreeModeOn = (key: string): boolean =>
  !!selectWorktreeModeDirs(getActiveWorkspaceId())(getUserStoreState())?.includes(key);

export const worktreeModeKeyOf = (keyDeviceId: string | undefined, path: string) =>
  getWorktreeModeKey(keyDeviceId ?? 'local', path);

/**
 * The composer's "New worktree" switch for one device + directory. Remembered
 * per workspace + user (see `setWorktreeModeDir`), so another directory, or the
 * same directory in another workspace, keeps its own state.
 */
export const useWorktreeMode = (keyDeviceId: string | undefined, path: string) => {
  const { t } = useTranslation('device');
  const workspaceId = useActiveWorkspaceId();
  useUserStore((s) => s.useFetchWorkspaceUserPreference)();
  const key = worktreeModeKeyOf(keyDeviceId, path);
  const dirs = useUserStore(selectWorktreeModeDirs(workspaceId));
  const setWorktreeModeDir = useUserStore((s) => s.setWorktreeModeDir);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      try {
        await setWorktreeModeDir(key, enabled);
      } catch (error) {
        console.error('[useWorktreeMode] save failed', error);
        toast.error(t('workingDirectory.worktreeToggleSaveFailed'));
      }
    },
    [key, setWorktreeModeDir, t],
  );

  return { enabled: !!dirs?.includes(key), key, ready: dirs !== undefined, setEnabled };
};
