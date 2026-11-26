import type { VirtuaScrollMethods } from '../../store/slices/virtuaList/initialState';

interface KeepRowInPlaceParams {
  /** The row the reader is looking at, which must not move on screen. */
  anchorId: string;
  /** Row ids as rendered right now; read again after `run` for the new layout. */
  getRowIds: () => string[];
  getScrollMethods: () => VirtuaScrollMethods | null;
  /** Resolves once the list has rendered what `run` changed. */
  nextRender: () => Promise<void>;
  /** Inserts rows somewhere above the anchor. */
  run: () => Promise<void>;
}

/**
 * Insert rows above the anchor while the anchor keeps its spot in the viewport.
 * virtua's `shift` only keeps the view still for rows prepended at the very
 * start, so rows inserted mid-list would otherwise push the anchor down by
 * their whole height.
 */
export const keepRowInPlace = async ({
  anchorId,
  getRowIds,
  getScrollMethods,
  nextRender,
  run,
}: KeepRowInPlaceParams) => {
  const before = getScrollMethods();
  const indexBefore = getRowIds().indexOf(anchorId);
  const viewportTop =
    before && indexBefore >= 0
      ? before.getItemOffset(indexBefore) - before.getScrollOffset()
      : undefined;

  await run();
  if (viewportTop === undefined) return;

  await nextRender();
  const after = getScrollMethods();
  const indexAfter = getRowIds().indexOf(anchorId);
  if (!after || indexAfter < 0 || indexAfter === indexBefore) return;

  after.scrollTo(after.getItemOffset(indexAfter) - viewportTop);
};
