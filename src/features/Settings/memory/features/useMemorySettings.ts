import { type UserMemoryEffort } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useCallback } from 'react';

import { type SaveStateHandle } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

interface UseMemorySettingsOptions {
  canManageMemory: boolean;
  save: SaveStateHandle['save'];
}

export const useMemorySettings = ({ canManageMemory, save }: UseMemorySettingsOptions) => {
  const memory = useUserStore(settingsSelectors.currentMemorySettings, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);

  const setEnabled = useCallback(
    (enabled: boolean) => {
      if (!canManageMemory) return;

      return save(() => setSettings({ memory: { enabled } }));
    },
    [canManageMemory, save, setSettings],
  );

  const setEffort = useCallback(
    (effort: UserMemoryEffort) => {
      if (!canManageMemory) return;

      return save(() => setSettings({ memory: { effort } }));
    },
    [canManageMemory, save, setSettings],
  );

  return {
    effort: memory.effort ?? 'medium',
    enabled: memory.enabled !== false,
    isUserStateInit,
    setEffort,
    setEnabled,
  };
};
