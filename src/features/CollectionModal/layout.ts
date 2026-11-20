/** Width of one square tile in the collection grid. */
const COLLECTION_TILE_SIZE = 200;
const COLLECTION_GRID_GAP = 12;

/** Two columns at least, so a single image and the title get room; the grid stretches it. */
const MIN_COLUMNS = 2;
const MAX_COLUMNS = 4;
/** The modal body's horizontal padding (both sides). */
const MODAL_PADDING_X = 48;

/**
 * Modal width that fits the images instead of a fixed wide panel: two images
 * would otherwise sit in the left third of a 960px modal. Without a known count
 * (the modal loads the images itself) it falls back to four columns.
 */
export const getCollectionModalWidth = (count?: number) => {
  const columns = Math.min(Math.max(count ?? MAX_COLUMNS, MIN_COLUMNS), MAX_COLUMNS);
  const content = columns * COLLECTION_TILE_SIZE + (columns - 1) * COLLECTION_GRID_GAP;

  return `min(95vw, ${content + MODAL_PADDING_X}px)`;
};
