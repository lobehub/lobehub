'use client';

import { type DraggablePanelProps } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { useCallback, useState } from 'react';

import { useTypeScriptHappyCallback } from '@/hooks/useTypeScriptHappyCallback';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export const useNavPanel = () => {
  const [leftPanelWidth, sessionExpandable, togglePanel, updatePreference] = useGlobalStore((s) => [
    systemStatusSelectors.leftPanelWidth(s),
    systemStatusSelectors.showLeftPanel(s),
    s.toggleLeftPanel,
    s.updateSystemStatus,
  ]);

  const [tmpWidth, setWidth] = useState(leftPanelWidth);

  if (tmpWidth !== leftPanelWidth) setWidth(leftPanelWidth);

  const handleSizeChange: DraggablePanelProps['onSizeChange'] = useTypeScriptHappyCallback(
    (_, size) => {
      const width = typeof size?.width === 'string' ? Number.parseInt(size.width) : size?.width;
      if (!width || width < 64) return;
      if (isEqual(width, leftPanelWidth)) return;
      setWidth(width);
      updatePreference({ leftPanelWidth: width });
    },
    [sessionExpandable, leftPanelWidth, updatePreference],
  );

  const openPanel = useCallback(() => {
    togglePanel(true);
  }, [togglePanel]);

  const closePanel = useCallback(() => {
    togglePanel(false);
  }, [togglePanel]);

  return {
    closePanel,
    defaultWidth: tmpWidth,
    expand: sessionExpandable,
    handleSizeChange,
    openPanel,
    togglePanel,
    width: leftPanelWidth,
  };
};
