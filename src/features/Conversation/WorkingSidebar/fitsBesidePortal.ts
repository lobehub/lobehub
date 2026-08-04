import { CONVERSATION_KEEP_WIDTH } from '@/const/layoutTokens';

interface FitsBesidePortalParams {
  /** measured width of the row holding conversation + portal + sidebar */
  availableWidth?: number;
  /** 0 when the portal is closed */
  portalWidth: number;
  sidebarWidth: number;
}

/**
 * The conversation, the portal and the working sidebar share one row. A wide
 * portal (an acceptance report opens at 840) plus the sidebar can consume the
 * whole row and leave the conversation at zero width, so the sidebar yields
 * first: keeping conversation + portal beats keeping all three.
 *
 * Returns true while all three fit — before the row has been measured too, so
 * the first paint matches the user's own `showRightPanel` preference instead of
 * flashing the sidebar away.
 */
export const fitsBesidePortal = ({
  availableWidth,
  portalWidth,
  sidebarWidth,
}: FitsBesidePortalParams): boolean => {
  if (!availableWidth) return true;

  return availableWidth - portalWidth - sidebarWidth >= CONVERSATION_KEEP_WIDTH;
};
