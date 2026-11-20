/**
 * What the marketplace grid renders below its rows.
 *
 * `error` is its own state on purpose: a page that failed to load must not fall
 * through to the idle spacer, where a partially loaded list reads as complete.
 */
export type MCPListFooter = 'error' | 'exhausted' | 'loading' | 'spacer';

export interface MCPListPagingState {
  hasMore: boolean;
  isLoadingMore?: boolean;
  loadMoreError?: unknown;
}

export const resolveMCPListFooter = (list: MCPListPagingState): MCPListFooter => {
  if (list.isLoadingMore) return 'loading';
  if (list.loadMoreError) return 'error';
  if (!list.hasMore) return 'exhausted';
  return 'spacer';
};

/**
 * Whether reaching the end of the grid may request another page. While the last
 * page is failing, paging waits for the footer's explicit retry instead of
 * re-firing on every scroll.
 */
export const canAutoLoadMore = (list: MCPListPagingState): boolean =>
  list.hasMore && !list.loadMoreError;
