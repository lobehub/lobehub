import { type DraggablePanelSize } from '@lobehub/ui';
import { useCallback, useState } from 'react';

export const DETAIL_PANEL_DEFAULT_WIDTH = 480;
export const DETAIL_PANEL_MIN_WIDTH = 320;

/**
 * The detail panel width is controlled, so a resize must be written back here or
 * the drag snaps the panel straight back to its previous width.
 */
export const useDetailPanelWidth = () => {
  const [width, setWidth] = useState<number | string>(DETAIL_PANEL_DEFAULT_WIDTH);

  const handleSizeChange = useCallback((_delta: DraggablePanelSize, size: DraggablePanelSize) => {
    if (size?.width) setWidth(size.width);
  }, []);

  return { handleSizeChange, width };
};
