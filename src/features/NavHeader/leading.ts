export interface NavHeaderLeadingInput {
  /** The desktop left panel is open (the toggle is then redundant). */
  expand: boolean;
  /** macOS Electron, where the toggle lives in the titlebar. */
  isMacDesktop: boolean;
  /** The mobile SPA bundle, which has no left panel. */
  mobile: boolean;
  /** The header was given no left / right / center content. */
  noContent: boolean;
  showTogglePanelButton: boolean;
}

/**
 * What a `NavHeader` puts before its own content:
 * - `hidden`: render no header at all,
 * - `mobile`: back button + the route sidebar drawer,
 * - `toggle`: the desktop left panel toggle,
 * - `none`: nothing extra.
 */
export type NavHeaderLeading = 'hidden' | 'mobile' | 'none' | 'toggle';

export const getNavHeaderLeading = ({
  expand,
  isMacDesktop,
  mobile,
  noContent,
  showTogglePanelButton,
}: NavHeaderLeadingInput): NavHeaderLeading => {
  if (mobile) {
    // A full-screen mobile page always needs a way back; a panel header that
    // opts out of the toggle and has nothing to show stays hidden.
    if (!showTogglePanelButton) return noContent ? 'hidden' : 'none';
    return 'mobile';
  }

  // When empty, the header only exists to host the collapse toggle: hide it
  // while the panel is open and on macOS desktop, where the toggle is in the titlebar.
  if (noContent && (expand || isMacDesktop)) return 'hidden';
  return showTogglePanelButton && !expand ? 'toggle' : 'none';
};
