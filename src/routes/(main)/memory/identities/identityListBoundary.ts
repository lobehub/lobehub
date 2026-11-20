interface IdentityListBoundaryParams {
  /** Error of the head request for the query now on screen. */
  error: unknown;
  /** `true` once any identity page has landed (survives a query change). */
  init: boolean;
  /** The painted rows were fetched for another search / type filter. */
  isStaleQuery: boolean;
}

interface IdentityListBoundaryState {
  /** Error to surface as the full-surface failure (with retry), if any. */
  error: unknown;
  /** Hide the rows behind the loading state while the new query resolves. */
  isResetting: boolean;
  /** The store rows answer the query on screen and may be rendered. */
  showRows: boolean;
}

/**
 * What the identities list boundary renders for the current query.
 *
 * The replica is the source of truth once it has painted *this* query, so a
 * failed background revalidation keeps its rows. Rows painted for another
 * query are never this query's answer: while the new head page is in flight
 * they stay hidden behind the loading state, and when that request fails the
 * failure (and its retry) is shown instead of the previous query's rows.
 */
export const identityListBoundary = ({
  error,
  init,
  isStaleQuery,
}: IdentityListBoundaryParams): IdentityListBoundaryState => {
  const failed = Boolean(error);

  return {
    error: failed && (!init || isStaleQuery) ? error : undefined,
    isResetting: isStaleQuery && !failed,
    showRows: init && !isStaleQuery,
  };
};
