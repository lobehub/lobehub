import type { WebContents } from 'electron';

/**
 * A fixed viewport the agent asked for. The page lays out at `width`×`height`
 * and the panel draws it shrunk by `scale` to fit, so panel pixels (input
 * coordinates, capture rectangles) are the page's CSS pixels times `scale`.
 */
export interface GuestViewport {
  height: number;
  /** Panel size the scale was fitted to; emulation hides it from the page. */
  panel: { height: number; width: number };
  scale: number;
  width: number;
}

/**
 * Kept per page, not per session: a remounted guest starts at the panel size
 * again. Shared by the controllers that turn page coordinates into panel ones
 * (agent clicks and screenshots, element-picker thumbnails).
 */
export const guestViewports = new WeakMap<WebContents, GuestViewport>();

/** How far the panel shrinks the guest's page; 1 without a fixed viewport. */
export const guestViewportScale = (guest: WebContents): number =>
  guestViewports.get(guest)?.scale ?? 1;
