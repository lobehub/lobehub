'use client';

import { type DraggablePanelProps } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';

import { useTypeScriptHappyCallback } from '@/hooks/useTypeScriptHappyCallback';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export const useNavPanelSizeChangeHandler = (onChange?: (width: number) => void) => {
  const handleSizeChange: DraggablePanelProps['onSizeChange'] = useTypeScriptHappyCallback(
    (_, size) => {
      const width = typeof size?.width === 'string' ? Number.parseInt(size.width) : size?.width;
      if (!width || width < 64) return;
      const s = useGlobalStore.getState();
      const leftPanelWidth = systemStatusSelectors.leftPanelWidth(s);
      const updatePreference = s.updateSystemStatus;
      if (isEqual(width, leftPanelWidth)) return;
      onChange?.(width);
      updatePreference({ leftPanelWidth: width });
    },
    [],
  );

  return handleSizeChange;
};
