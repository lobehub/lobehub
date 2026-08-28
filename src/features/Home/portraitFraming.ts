/**
 * How much of the character the home surface actually shows.
 *
 * The home portrait hangs below its container so the lower body passes behind
 * the first card; what survives that overlap is this fraction of the character's
 * height, measured against the real layout (image box 200px tall, card top
 * 130px below the image's top edge).
 *
 * It lives here rather than inside the stylesheet because the artwork studio
 * draws the same fraction as a preview frame — if the two ever disagree, the
 * preview is lying about where home will cut.
 */
export const HOME_PORTRAIT_VISIBLE_RATIO = 0.65;
