interface IdentityControlsParams {
  /** A search term or a non-`all` type filter is active. */
  hasFilters: boolean;
  /** `true` once the first page has come back — before that nothing is known. */
  init: boolean;
  /** A reset / refetch is in flight, so `total` still describes the old query. */
  searchLoading?: boolean;
  /** Row count for the *current* query, not the whole collection. */
  total: number;
}

/**
 * Whether the identities page shows its action bar, type tabs and search box.
 *
 * They are hidden only for a genuinely empty collection, where they would be
 * controls over nothing. Two cases must keep them:
 *
 * - a filter is active — an empty *result set* still needs the search box that
 *   produced it, otherwise the user cannot get back;
 * - a refetch is in flight — `total` still carries the previous query's count,
 *   so clearing a search would blink the controls away and steal input focus.
 */
export const showIdentityControls = ({
  init,
  hasFilters,
  searchLoading,
  total,
}: IdentityControlsParams): boolean => init && (hasFilters || !!searchLoading || total > 0);
