import { useCallback } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors/systemStatus';

import { type GroupMode } from '../types';

export const usePanelState = () => {
  const groupMode = useGlobalStore(systemStatusSelectors.modelSwitchPanelGroupMode) as GroupMode;
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const handleGroupModeChange = useCallback(
    (mode: GroupMode) => {
      updateSystemStatus({ modelSwitchPanelGroupMode: mode });
    },
    [updateSystemStatus],
  );

  return { groupMode, handleGroupModeChange };
};
