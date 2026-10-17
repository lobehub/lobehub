interface LoadMoreFooterParams {
  /** A page (head revalidation or "load more") is in flight. */
  isLoading?: boolean;
  /** Failure of the last "load more" request. */
  loadMoreError?: unknown;
}

export type LoadMoreFooterState = 'error' | 'loading' | undefined;

/**
 * What a paginated memory list renders below its rows: the loading rows while a
 * page is in flight, otherwise the failure of the last "load more" (with a
 * retry) — the item count did not change, so the virtualized list would never
 * reach its end again on its own.
 */
export const resolveLoadMoreFooter = ({
  isLoading,
  loadMoreError,
}: LoadMoreFooterParams): LoadMoreFooterState => {
  if (isLoading) return 'loading';
  if (loadMoreError) return 'error';
  return undefined;
};

/**
 * Whether reaching the end of the list may request the next page. A failed page
 * waits for an explicit retry instead of re-firing on every scroll to the end.
 */
export const canAutoLoadMore = ({
  hasMore,
  loadMoreError,
}: {
  hasMore?: boolean;
  loadMoreError?: unknown;
}): boolean => Boolean(hasMore) && !loadMoreError;

/**
 * The end-of-list props of a paginated memory list's Virtuoso.
 *
 * Virtuoso only re-fires `endReached` when `[lastIndex, data]` changes. Without
 * `data`, a page set collapsed back to its head page (after a delete) ends at
 * the same index the head page already reported, so reaching the end again
 * never requests the next page. Passing the rendered rows as `data` keys the
 * trigger on the page set itself.
 */
export const autoLoadMoreProps = <T>({
  hasMore,
  items,
  loadMoreError,
  onLoadMore,
}: {
  hasMore?: boolean;
  items: readonly T[];
  loadMoreError?: unknown;
  onLoadMore?: () => void;
}): { data: readonly T[]; endReached?: () => void } => ({
  data: items,
  endReached: canAutoLoadMore({ hasMore, loadMoreError }) ? onLoadMore : undefined,
});
