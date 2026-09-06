/**
 * How much of the character the home surface actually shows.
 *
 * The home portrait hangs below its container so the lower body passes behind
 * the first card; what survives that overlap is this fraction of the character's
 * height, measured from the image's top edge to the supporting card.
 *
 * It lives here rather than inside the stylesheet because the artwork studio
 * draws the same fraction as a preview frame — if the two ever disagree, the
 * preview is lying about where home will cut.
 */
export const HOME_PORTRAIT_VISIBLE_RATIO = 0.65;

/** Shared with the greeting layout so text never enters the artwork's box. */
export const HOME_PORTRAIT_WIDTH = 176;
export const HOME_PORTRAIT_INSET = 12;

export const HOME_PORTRAIT_HEIGHT = 200;
/** Space between the hero row and the card that masks the portrait. */
export const HOME_PORTRAIT_CARD_GAP = 24;

/** Keep the visible fraction consistent with the artwork studio at every size. */
export const getHomePortraitOverlap = (height: number) =>
  height * (1 - HOME_PORTRAIT_VISIBLE_RATIO) + HOME_PORTRAIT_CARD_GAP;
