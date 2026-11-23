/** What the header's window button does where the board is shown. */
export type HeaderExit = 'close' | 'enterFullscreen' | 'exitFullscreen';

export interface HeaderChrome {
  /**
   * The board covers the whole window: the header sits under the macOS traffic
   * lights, so it clears them and doubles as the window's title bar.
   */
  coversWindow: boolean;
  exit: HeaderExit;
}

/**
 * The board header's chrome for where the board is shown:
 * - covering the whole window (`onExitFullscreen`): returns the board to the side panel;
 * - in the Works modal (`onClose`): inset from the window, it just closes the modal;
 * - in the side panel: offers to cover the window.
 */
export const headerChrome = ({
  onClose,
  onExitFullscreen,
}: {
  onClose?: unknown;
  onExitFullscreen?: unknown;
}): HeaderChrome => {
  if (onClose) return { coversWindow: false, exit: 'close' };
  if (onExitFullscreen) return { coversWindow: true, exit: 'exitFullscreen' };
  return { coversWindow: false, exit: 'enterFullscreen' };
};
