import { OVERLAY_LAYOUT } from './constants';
import type { DockResult } from './useDockPosition';

export interface PanelPlacement {
  left: number;
  top: number;
  width: number;
}

export const createDockedPanelPlacement = (dock: DockResult): PanelPlacement => ({
  left: dock.left,
  top: dock.top,
  width: OVERLAY_LAYOUT.panelWidthDocked,
});

export const createInitialPanelPlacement = (
  viewportWidth: number,
  viewportHeight: number,
): PanelPlacement => ({
  left: Math.round((viewportWidth - OVERLAY_LAYOUT.panelWidthInitial) / 2),
  top: Math.round(
    viewportHeight - OVERLAY_LAYOUT.panelHeightEstimate - OVERLAY_LAYOUT.panelBottomGap,
  ),
  width: OVERLAY_LAYOUT.panelWidthInitial,
});

export const resolvePanelPlacement = ({
  dockedPlacement,
  initialPlacement,
  lastSelectionPlacement,
}: {
  dockedPlacement: PanelPlacement | null;
  initialPlacement: PanelPlacement;
  lastSelectionPlacement: PanelPlacement | null;
}): PanelPlacement => dockedPlacement ?? lastSelectionPlacement ?? initialPlacement;
