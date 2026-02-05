import { useCallback, useMemo } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors/systemStatus';

import {
  FOOTER_HEIGHT,
  ITEM_HEIGHT,
  MAX_PANEL_HEIGHT,
  TOOLBAR_HEIGHT,
} from '../const';

export const usePanelSize = (enabledListLength: number) => {
  const panelWidth = useGlobalStore(systemStatusSelectors.modelSwitchPanelWidth);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const panelHeight = useMemo(
    () =>
      enabledListLength === 0
        ? TOOLBAR_HEIGHT + ITEM_HEIGHT['no-provider'] + FOOTER_HEIGHT
        : MAX_PANEL_HEIGHT,
    [enabledListLength],
  );

  const handlePanelWidthChange = useCallback(
    (width: number) => {
      updateSystemStatus({ modelSwitchPanelWidth: width });
    },
    [updateSystemStatus],
  );

  return { handlePanelWidthChange, panelHeight, panelWidth };
};
