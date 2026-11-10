'use client';

import { type DraggablePanelProps } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';

import { useTypeScriptHappyCallback } from '@/hooks/useTypeScriptHappyCallback';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

const endResizing = () => useGlobalStore.getState().setNavPanelResizing(false);

// DraggablePanel reports moves but not the drag ending, so the release is read off the window.
const markResizing = () => {
  const s = useGlobalStore.getState();
  if (s.isNavPanelResizing) return;

  s.setNavPanelResizing(true);
  window.addEventListener('pointerup', endResizing, { once: true });
  window.addEventListener('pointercancel', endResizing, { once: true });
};

export const useNavPanelSizeChangeHandler = (onChange?: (width: number) => void) => {
  const handleSizeChange: DraggablePanelProps['onSizeChange'] = useTypeScriptHappyCallback(
    (_, size) => {
      markResizing();
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
