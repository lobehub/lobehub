import { CONVERSATION_KEEP_WIDTH } from '@/const/layoutTokens';

interface SidebarWidthBudgetParams {
  /** measured width of the row holding conversation + portal + sidebar */
  availableWidth?: number;
  /** 0 when the portal is closed */
  portalWidth: number;
}

/**
 * The conversation, the portal and the working sidebar share one row. A wide
 * portal (an acceptance report opens at 840) plus the sidebar can consume the
 * whole row and leave the conversation at zero width, so the sidebar yields
 * first: this is the widest the sidebar may render while the conversation
 * keeps its share of the row.
 *
 * Infinity before the row has been measured, so the first paint matches the
 * user's own `showRightPanel` preference instead of flashing the sidebar away.
 */
export const sidebarWidthBudget = ({
  availableWidth,
  portalWidth,
}: SidebarWidthBudgetParams): number => {
  if (!availableWidth) return Number.POSITIVE_INFINITY;

  return availableWidth - portalWidth - CONVERSATION_KEEP_WIDTH;
};

interface FitsBesidePortalParams extends SidebarWidthBudgetParams {
  sidebarWidth: number;
}

/** True while conversation + portal + a `sidebarWidth`-wide sidebar all fit. */
export const fitsBesidePortal = ({ sidebarWidth, ...budget }: FitsBesidePortalParams): boolean =>
  sidebarWidth <= sidebarWidthBudget(budget);
