import { useCallback, useMemo } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors/systemStatus';
import { useDensityTokens } from '@/styles/density';

import { FOOTER_HEIGHT, MAX_PANEL_HEIGHT } from '../const';

export const usePanelSize = (enabledListLength: number) => {
  const panelWidth = useGlobalStore(systemStatusSelectors.modelSwitchPanelWidth);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const { controlHeight, toolbarHeight } = useDensityTokens();

  const panelHeight = useMemo(
    () =>
      enabledListLength === 0 ? toolbarHeight + controlHeight + FOOTER_HEIGHT : MAX_PANEL_HEIGHT,
    [controlHeight, enabledListLength, toolbarHeight],
  );

  const handlePanelWidthChange = useCallback(
    (width: number) => {
      updateSystemStatus({ modelSwitchPanelWidth: width });
    },
    [updateSystemStatus],
  );

  return { handlePanelWidthChange, panelHeight, panelWidth };
};
