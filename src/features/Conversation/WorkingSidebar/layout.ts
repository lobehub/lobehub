export const OVERVIEW_PANEL_WIDTH = 340;
export const MIN_PANEL_WIDTH = 300;
export const MAX_PANEL_WIDTH = 1200;

interface WorkingPanelPreference {
  showRightPanel?: boolean;
  showWorkingOverview: boolean;
  workingSidebarWidth: number;
}

export interface WorkingPanelPlaceholder {
  overview: boolean;
  rightPanelWidth?: number;
}

// Mirrors the sidebar's first paint, where the row is not measured yet and
// every width fits, so a skeleton can hold the same space before it mounts.
export const resolveWorkingPanelPlaceholder = ({
  showRightPanel,
  showWorkingOverview,
  workingSidebarWidth,
}: WorkingPanelPreference): WorkingPanelPlaceholder => ({
  overview: showWorkingOverview,
  rightPanelWidth: showRightPanel
    ? Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, workingSidebarWidth))
    : undefined,
});
