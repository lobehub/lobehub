const OVERVIEW_CARD_MARGIN = 16;
const OVERVIEW_SCROLLBAR_LANE = 12;

/** Geometry of the floating Overview card inside its slot. */
export const OVERVIEW_CARD = {
  /** Width the slot adds around the card: both margins plus the scrollbar lane. */
  gutter: OVERVIEW_CARD_MARGIN * 2 + OVERVIEW_SCROLLBAR_LANE,
  /** Space between the card and its slot's edges. */
  margin: OVERVIEW_CARD_MARGIN,
  /**
   * Extra room past the card's inline-end margin. The conversation scroller runs
   * underneath the slot to the column edge, and its scrollbar sits in this lane.
   */
  scrollbarLane: OVERVIEW_SCROLLBAR_LANE,
  width: 340,
} as const;
export const MIN_PANEL_WIDTH = 300;
export const MAX_PANEL_WIDTH = 1200;
// A canvas is a laid-out page; narrower than this it reflows into its mobile layout.
export const CANVAS_MIN_WIDTH = 560;

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
